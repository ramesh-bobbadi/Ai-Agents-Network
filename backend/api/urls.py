from django.urls import path
from .views import (
    HealthCheckView,
    AgentListCreateView,
    AgentDetailView,
    ActiveAgentView,
    RefreshAgentEmbeddingView,
)

urlpatterns = [
    # Health check
    path('health/', HealthCheckView.as_view(), name='health-check'),

    # Agents, identity & active agent session
    path('agents/', AgentListCreateView.as_view(), name='agent-list-create'),
    path('agents/active/', ActiveAgentView.as_view(), name='agent-active'),
    path('agents/<uuid:pk>/', AgentDetailView.as_view(), name='agent-detail'),
    path('agents/<uuid:pk>/refresh-embedding/', RefreshAgentEmbeddingView.as_view(), name='agent-refresh-embedding'),
]
