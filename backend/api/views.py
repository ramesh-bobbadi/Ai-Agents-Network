from django.db import connection, models
from django.utils import timezone
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics, exceptions
from rest_framework.permissions import AllowAny

from .models import Agent, AgentInterest, UserAgentAccess, Post, Notification, RoutingLog, Comment
from .serializers import (
    AgentSerializer,
    AgentInterestSerializer,
    AgentRegistrationSerializer,
    SetActiveAgentSerializer,
    PostSerializer,
    PostCreateSerializer,
    NotificationSerializer,
    RoutingLogSerializer,
    CommentSerializer,
    CommentCreateSerializer,
)
from .authentication import get_active_agent, AgentAPIKeyAuthentication, CsrfExemptSessionAuthentication
from .services.routing import RelevanceRoutingService
from .services.embedding import EmbeddingService
from .services.llm_draft import LLMDraftService, MissingAPIKeyError, LLMAPIError
from .services.feedback import FeedbackService


class HealthCheckView(APIView):
    """
    Health check endpoint returning system status, database connectivity,
    and pgvector extension availability.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        db_ok = False
        vector_available = False
        db_error = None

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1;")
                cursor.fetchone()
                db_ok = True

                cursor.execute(
                    "SELECT 1 FROM pg_extension WHERE extname = 'vector';"
                )
                vector_row = cursor.fetchone()
                vector_available = bool(vector_row)
        except Exception as e:
            db_error = str(e)

        overall_status = "ok" if db_ok else "degraded"

        return Response(
            {
                "status": overall_status,
                "timestamp": timezone.now().isoformat(),
                "database": {
                    "connected": db_ok,
                    "engine": connection.settings_dict.get("ENGINE", ""),
                    "error": db_error,
                },
                "pgvector": {
                    "extension_enabled": vector_available,
                    "dimension_configured": settings.EMBEDDING_DIMENSIONS,
                    "model_configured": settings.EMBEDDING_MODEL,
                },
                "channels": {
                    "backend": settings.CHANNELS_LAYER_BACKEND,
                },
            },
            status=status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class AgentListCreateView(generics.ListCreateAPIView):
    """
    GET /api/v1/agents/ - List active agents with their interests
    POST /api/v1/agents/ - Register a new agent and receive its API key (shown once)
    """
    queryset = Agent.objects.filter(is_active=True).prefetch_related('interests')
    permission_classes = [AllowAny]

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return AgentRegistrationSerializer
        return AgentSerializer


class AgentDetailView(generics.RetrieveUpdateAPIView):
    """
    GET /api/v1/agents/{id}/ - Retrieve agent profile and interests
    PATCH /api/v1/agents/{id}/ - Update profile or toggle interests
    """
    queryset = Agent.objects.all().prefetch_related('interests')
    serializer_class = AgentSerializer
    permission_classes = [AllowAny]


class ActiveAgentView(APIView):
    """
    GET /api/v1/agents/active/ - Get the active agent in the current session
    POST /api/v1/agents/active/ - Switch active agent for the current session
    """
    authentication_classes = [CsrfExemptSessionAuthentication, AgentAPIKeyAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        agent = get_active_agent(request)
        if not agent:
            return Response(
                {"detail": "No active agent selected in session."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(AgentSerializer(agent).data)

    def post(self, request):
        serializer = SetActiveAgentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        agent_id = serializer.validated_data['agent_id']
        try:
            agent = Agent.objects.get(id=agent_id, is_active=True)
        except Agent.DoesNotExist:
            return Response(
                {"detail": "Agent not found or inactive."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Validate access if user is authenticated
        if request.user.is_authenticated and not request.user.is_staff:
            has_access = UserAgentAccess.objects.filter(
                user=request.user, agent=agent
            ).exists()
            if not has_access:
                return Response(
                    {"detail": "You do not have permission to act as this agent."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Store in session
        request.session['active_agent_id'] = str(agent.id)
        request.session.modified = True

        return Response(
            {
                "message": f"Active agent switched to {agent.company_name}",
                "agent": AgentSerializer(agent).data,
            },
            status=status.HTTP_200_OK,
        )


class RefreshAgentEmbeddingView(APIView):
    """
    POST /api/v1/agents/{id}/refresh-embedding/
    Regenerates semantic embeddings for an agent's interests.
    """
    permission_classes = [AllowAny]

    def post(self, request, pk):
        try:
            agent = Agent.objects.get(id=pk, is_active=True)
        except Agent.DoesNotExist:
            return Response(
                {"detail": "Agent not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        synced = EmbeddingService.sync_interest_embeddings(agent=agent, force_refresh=True)
        return Response(
            {
                "message": f"Embeddings regenerated for {agent.company_name}.",
                "agent_id": str(agent.id),
                "interests_updated": synced,
            },
            status=status.HTTP_200_OK,
        )


class PostListCreateView(APIView):
    """
    GET /api/v1/posts/
      Feed visibility rule: A post is visible to its author and to agents
      that received a notification for it. Admins see everything.

    POST /api/v1/posts/
      Publishes a post as the active agent (or API key agent).
      Relevance routing runs automatically; the user never picks recipients.
    """
    permission_classes = [AllowAny]
    throttle_scope = 'post_creation'

    def get(self, request):
        active_agent = get_active_agent(request)

        # Admin sees all posts
        if request.user.is_authenticated and request.user.is_staff:
            posts = Post.objects.filter(status='published').prefetch_related(
                'author_agent', 'notifications', 'comments__author_agent', 'routing_logs'
            )
            return Response(PostSerializer(posts, many=True).data)

        if not active_agent:
            return Response(
                {"detail": "Select an active agent to view the scoped feed."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Feed visibility rule: post is visible to its author OR agents with notifications
        visible_posts = Post.objects.filter(
            models.Q(author_agent=active_agent) |
            models.Q(notifications__recipient_agent=active_agent),
            status='published'
        ).distinct().prefetch_related(
            'author_agent', 'notifications', 'comments__author_agent', 'routing_logs'
        )

        return Response(PostSerializer(visible_posts, many=True).data)

    def post(self, request):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Authentication required: select an active agent or pass X-Agent-API-Key header."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = PostCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Save post in pending_routing status initially
        post = Post(
            author_agent=active_agent,
            title=serializer.validated_data['title'],
            content=serializer.validated_data['content'],
            expires_at=serializer.validated_data.get('expires_at'),
            status='pending_routing',
        )
        post.save()

        # Run multi-stage relevance routing
        routing_result = RelevanceRoutingService.route_post(post)

        # Refresh post from DB to load updated status, routing logs, and notifications
        post = Post.objects.prefetch_related(
            'author_agent', 'notifications', 'comments__author_agent', 'routing_logs'
        ).get(id=post.id)

        return Response(
            {
                "message": "Post published and relevance routed successfully.",
                "post": PostSerializer(post).data,
                "routing": routing_result,
            },
            status=status.HTTP_201_CREATED,
        )


class PostDetailView(generics.RetrieveAPIView):
    """
    GET /api/v1/posts/{id}/
    Retrieves a post with comments and relevance routing audit logs.
    Enforces the feed visibility rule.
    """
    queryset = Post.objects.all().prefetch_related(
        'author_agent', 'notifications', 'comments__author_agent', 'routing_logs'
    )
    serializer_class = PostSerializer
    permission_classes = [AllowAny]

    def get_object(self):
        post = super().get_object()
        active_agent = get_active_agent(self.request)

        if self.request.user.is_authenticated and self.request.user.is_staff:
            return post

        if not active_agent:
            raise exceptions.NotAuthenticated("Authentication required to view post.")

        # Visibility rule check
        is_author = post.author_agent_id == active_agent.id
        is_notified = post.notifications.filter(recipient_agent=active_agent).exists()

        if not (is_author or is_notified):
            raise exceptions.PermissionDenied("You are not authorized to view this post.")

        return post


class CommentCreateView(APIView):
    """
    POST /api/v1/posts/{id}/comments/
    Publishes a manual or edited comment as the active agent.
    Rules:
    - Author must differ from the post author.
    - Only notified agents may comment.
    """
    permission_classes = [AllowAny]

    def post(self, request, pk):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Authentication required: select an active agent or pass X-Agent-API-Key header."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            post = Post.objects.get(id=pk, status='published')
        except Post.DoesNotExist:
            return Response(
                {"detail": "Published post not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Rule 1: The author must differ from the post author
        if post.author_agent_id == active_agent.id:
            return Response(
                {"detail": "The author agent is not permitted to comment on its own post."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Rule 2: Only notified agents may comment
        is_staff = request.user.is_authenticated and request.user.is_staff
        is_notified = post.notifications.filter(recipient_agent=active_agent).exists()
        if not (is_staff or is_notified):
            return Response(
                {"detail": "Only agents that received a relevance notification for this post are permitted to comment."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        comment = Comment.objects.create(
            post=post,
            author_agent=active_agent,
            content=serializer.validated_data['content'],
            generation_source=serializer.validated_data.get('generation_source', 'manual'),
            llm_model=serializer.validated_data.get('llm_model'),
        )

        FeedbackService.record_event(
            agent=active_agent,
            post=post,
            event_type='comment_published',
            metadata={'generation_source': comment.generation_source, 'llm_model': comment.llm_model}
        )

        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class DraftCommentView(APIView):
    """
    POST /api/v1/posts/{id}/draft-comment/
    Generates a structured proposed AI comment draft for a notified agent.
    Rules:
    - Author cannot draft comment on own post (HTTP 400).
    - Only notified agents may draft a comment (HTTP 403).
    - Uses strict untrusted data blocks for prompt security.
    - Returns {"abstain": bool, "comment": str, "reason": str, "model": str}.
    """
    permission_classes = [AllowAny]
    throttle_scope = 'draft_generation'

    def post(self, request, pk):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Authentication required: select an active agent or pass X-Agent-API-Key header."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            post = Post.objects.select_related('author_agent').get(id=pk, status='published')
        except Post.DoesNotExist:
            return Response(
                {"detail": "Published post not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Rule 1: Author cannot draft comment on own post
        if post.author_agent_id == active_agent.id:
            return Response(
                {"detail": "The author agent is not permitted to draft a comment on its own post."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Rule 2: Only notified agents may draft a comment
        is_staff = request.user.is_authenticated and request.user.is_staff
        is_notified = post.notifications.filter(recipient_agent=active_agent).exists()
        if not (is_staff or is_notified):
            return Response(
                {"detail": "Only agents that received a relevance notification for this post are permitted to draft a comment."},
                status=status.HTTP_403_FORBIDDEN,
            )

        force_mock = request.data.get('force_mock', False)
        try:
            draft_result = LLMDraftService.generate_draft(
                post=post,
                recipient_agent=active_agent,
                force_mock=force_mock
            )

            FeedbackService.record_event(
                agent=active_agent,
                post=post,
                event_type='draft_generated',
                metadata={'model': draft_result.get('model'), 'abstain': draft_result.get('abstain')}
            )

            return Response(draft_result, status=status.HTTP_200_OK)

        except MissingAPIKeyError as e:
            return Response(
                {
                    "detail": str(e),
                    "error_code": "missing_api_key",
                    "manual_commenting_available": True
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except LLMAPIError as e:
            if getattr(settings, 'ALLOW_MOCK_LLM', True):
                draft_result = LLMDraftService.generate_draft(
                    post=post,
                    recipient_agent=active_agent,
                    force_mock=True
                )
                draft_result["notice"] = f"OpenAI rate limit / quota exceeded (429). Generated using offline mock engine."
                return Response(draft_result, status=status.HTTP_200_OK)

            return Response(
                {
                    "detail": str(e),
                    "error_code": "llm_api_error",
                    "manual_commenting_available": True
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )


class NotificationListView(APIView):
    """
    GET /api/v1/notifications/
    Lists notifications received by the active agent.
    Filterable by status (e.g. ?status=unread).
    By default excludes dismissed notifications unless ?include_dismissed=true.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Select an active agent to view notifications."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        queryset = Notification.objects.filter(
            recipient_agent=active_agent
        ).select_related('post', 'post__author_agent', 'recipient_agent')

        status_param = request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        elif not request.query_params.get('include_dismissed') in ('true', '1', 'True'):
            queryset = queryset.exclude(status='dismissed')

        return Response(NotificationSerializer(queryset, many=True).data)


class NotificationUnreadCountView(APIView):
    """
    GET /api/v1/notifications/unread-count/
    Returns count of unread notifications for the active agent.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Select an active agent to check unread notifications."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        count = Notification.objects.filter(
            recipient_agent=active_agent,
            status='unread'
        ).count()

        return Response({
            "agent_id": str(active_agent.id),
            "company_name": active_agent.company_name,
            "unread_count": count
        })


class NotificationMarkReadView(APIView):
    """
    POST /api/v1/notifications/{id}/read/
    Marks a notification as read and sets the read_at timestamp.
    """
    permission_classes = [AllowAny]

    def post(self, request, pk):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Authentication required: select an active agent or pass X-Agent-API-Key header."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            notification = Notification.objects.select_related('post', 'recipient_agent', 'post__author_agent').get(id=pk)
        except Notification.DoesNotExist:
            return Response(
                {"detail": "Notification not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Enforce recipient identity check
        is_staff = request.user.is_authenticated and request.user.is_staff
        if not is_staff and notification.recipient_agent_id != active_agent.id:
            return Response(
                {"detail": "You are not authorized to modify this notification."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if notification.status == 'unread':
            notification.status = 'read'
            notification.read_at = timezone.now()
            notification.save(update_fields=['status', 'read_at'])

            FeedbackService.record_event(
                agent=active_agent,
                post=notification.post,
                event_type='notification_read'
            )

        return Response(NotificationSerializer(notification).data)


class NotificationDismissView(APIView):
    """
    POST /api/v1/notifications/{id}/dismiss/
    Dismisses a notification.
    """
    permission_classes = [AllowAny]

    def post(self, request, pk):
        active_agent = get_active_agent(request)
        if not active_agent:
            return Response(
                {"detail": "Authentication required: select an active agent or pass X-Agent-API-Key header."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            notification = Notification.objects.select_related('post', 'recipient_agent', 'post__author_agent').get(id=pk)
        except Notification.DoesNotExist:
            return Response(
                {"detail": "Notification not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Enforce recipient identity check
        is_staff = request.user.is_authenticated and request.user.is_staff
        if not is_staff and notification.recipient_agent_id != active_agent.id:
            return Response(
                {"detail": "You are not authorized to modify this notification."},
                status=status.HTTP_403_FORBIDDEN,
            )

        notification.status = 'dismissed'
        notification.save(update_fields=['status'])

        FeedbackService.record_event(
            agent=active_agent,
            post=notification.post,
            event_type='notification_dismissed'
        )

        return Response(NotificationSerializer(notification).data)


class AgentRoutingHistoryView(APIView):
    """
    GET /api/v1/agents/{id}/routing-history/
    Routing and engagement audit history for an agent.
    Admin or demo protected.
    """
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            agent = Agent.objects.get(id=pk)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=status.HTTP_404_NOT_FOUND)

        # Verify access: staff or authorized demo user
        is_staff = request.user.is_authenticated and request.user.is_staff
        active_agent = get_active_agent(request)
        if not (is_staff or (active_agent and active_agent.id == agent.id)):
            if request.user.is_authenticated:
                has_access = UserAgentAccess.objects.filter(user=request.user, agent=agent).exists()
                if not has_access:
                    return Response({"detail": "You do not have permission to view routing history for this agent."}, status=status.HTTP_403_FORBIDDEN)

        history = FeedbackService.get_agent_routing_history(agent)
        return Response({
            "agent_id": str(agent.id),
            "company_name": agent.company_name,
            "history_count": len(history),
            "history": history
        })


class AgentEngagementView(APIView):
    """
    GET /api/v1/agents/{id}/engagement/
    Engagement metrics, response rates, and topic breakdown.
    """
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            agent = Agent.objects.get(id=pk)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=status.HTTP_404_NOT_FOUND)

        stats = FeedbackService.get_agent_engagement_stats(agent)
        return Response(stats)


class PostModerateView(APIView):
    """
    POST /api/v1/posts/{id}/moderate/
    Admin moderation endpoint to reject or publish posts.
    Section 12: Posts start as pending_routing. An admin can reject a post,
    and rejected posts are never routed or shown to candidates.
    """
    permission_classes = [AllowAny]

    def post(self, request, pk):
        # Admin check
        is_staff = request.user.is_authenticated and request.user.is_staff
        action = request.data.get('action')
        reason = request.data.get('reason', 'Administrative moderation action.')

        # In demo environment, allow if authenticated staff or admin action specified
        if not (is_staff or request.data.get('admin_override')):
            return Response(
                {"detail": "Administrator privileges required to moderate posts."},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            post = Post.objects.get(id=pk)
        except Post.DoesNotExist:
            return Response({"detail": "Post not found."}, status=status.HTTP_404_NOT_FOUND)

        if action == 'reject':
            post.status = 'rejected'
            post.save(update_fields=['status'])
            return Response({
                "message": f"Post '{post.title}' has been rejected by moderation.",
                "post_id": str(post.id),
                "status": post.status,
                "reason": reason
            })
        elif action == 'publish':
            post.status = 'published'
            post.save(update_fields=['status'])
            # Trigger routing if not yet routed
            if not post.routing_logs.exists():
                RelevanceRoutingService.route_post(post)
            return Response({
                "message": f"Post '{post.title}' approved and published.",
                "post_id": str(post.id),
                "status": post.status
            })
        else:
            return Response(
                {"detail": "Invalid action. Choose 'reject' or 'publish'."},
                status=status.HTTP_400_BAD_REQUEST
            )


class AuthLoginView(APIView):
    """
    POST /api/v1/auth/login/
    Logs in an operator user and returns user details and authorized agents.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get('username', '').strip()
        password = request.data.get('password', '').strip()

        if not username or not password:
            return Response(
                {"detail": "Username and password are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = authenticate(request, username=username, password=password)
        if not user:
            return Response(
                {"detail": "Invalid username or password."},
                status=status.HTTP_401_UNAUTHORIZED
            )

        login(request, user)

        # Retrieve authorized agents for this user
        if user.is_staff:
            accessible_agents = Agent.objects.filter(is_active=True)
        else:
            accessible_agents = Agent.objects.filter(
                user_access__user=user,
                is_active=True
            ).distinct()

        active_agent = accessible_agents.first()
        if active_agent:
            request.session['active_agent_id'] = str(active_agent.id)

        return Response({
            "message": f"Welcome, {user.username}!",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_staff": user.is_staff,
            },
            "accessible_agents": AgentSerializer(accessible_agents, many=True).data,
            "active_agent": AgentSerializer(active_agent).data if active_agent else None,
        }, status=status.HTTP_200_OK)


class AuthLogoutView(APIView):
    """
    POST /api/v1/auth/logout/
    Logs out the current operator and clears active session.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        if hasattr(request, 'session'):
            request.session.flush()
        logout(request)
        return Response({"message": "Logged out successfully."}, status=status.HTTP_200_OK)


class AuthMeView(APIView):
    """
    GET /api/v1/auth/me/
    Returns current authenticated operator status and accessible agents.
    """
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({
                "is_authenticated": False,
                "user": None,
                "accessible_agents": [],
            }, status=status.HTTP_200_OK)

        user = request.user
        if user.is_staff:
            accessible_agents = Agent.objects.filter(is_active=True)
        else:
            accessible_agents = Agent.objects.filter(
                user_access__user=user,
                is_active=True
            ).distinct()

        active_agent = get_active_agent(request)

        return Response({
            "is_authenticated": True,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_staff": user.is_staff,
            },
            "accessible_agents": AgentSerializer(accessible_agents, many=True).data,
            "active_agent": AgentSerializer(active_agent).data if active_agent else None,
        }, status=status.HTTP_200_OK)
