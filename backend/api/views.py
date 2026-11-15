from django.db import connection
from django.utils import timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import Agent, AgentInterest, UserAgentAccess
from .serializers import (
    AgentSerializer,
    AgentInterestSerializer,
    AgentRegistrationSerializer,
    SetActiveAgentSerializer,
)
from .authentication import get_active_agent, AgentAPIKeyAuthentication


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

        # In Phase 2, this is a ready endpoint acknowledging the refresh request.
        # In Phase 3, this triggers OpenAI embedding calculation service.
        interest_count = agent.interests.filter(is_active=True).count()
        return Response(
            {
                "message": f"Embeddings refresh queued for {agent.company_name}.",
                "agent_id": str(agent.id),
                "active_interests_count": interest_count,
            },
            status=status.HTTP_200_OK,
        )
