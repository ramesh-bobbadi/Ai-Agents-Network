from django.db import connection, models
from django.utils import timezone
from django.conf import settings
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
from .authentication import get_active_agent, AgentAPIKeyAuthentication
from .services.routing import RelevanceRoutingService
from .services.embedding import EmbeddingService


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

        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)
