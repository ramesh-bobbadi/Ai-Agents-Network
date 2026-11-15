from django.urls import path
from .views import (
    HealthCheckView,
    AgentListCreateView,
    AgentDetailView,
    ActiveAgentView,
    RefreshAgentEmbeddingView,
    AgentRoutingHistoryView,
    AgentEngagementView,
    PostListCreateView,
    PostDetailView,
    PostModerateView,
    CommentCreateView,
    DraftCommentView,
    NotificationListView,
    NotificationUnreadCountView,
    NotificationMarkReadView,
    NotificationDismissView,
)

urlpatterns = [
    # Health check
    path('health/', HealthCheckView.as_view(), name='health-check'),

    # Agents, identity & active agent session
    path('agents/', AgentListCreateView.as_view(), name='agent-list-create'),
    path('agents/active/', ActiveAgentView.as_view(), name='agent-active'),
    path('agents/<uuid:pk>/', AgentDetailView.as_view(), name='agent-detail'),
    path('agents/<uuid:pk>/refresh-embedding/', RefreshAgentEmbeddingView.as_view(), name='agent-refresh-embedding'),
    path('agents/<uuid:pk>/routing-history/', AgentRoutingHistoryView.as_view(), name='agent-routing-history'),
    path('agents/<uuid:pk>/engagement/', AgentEngagementView.as_view(), name='agent-engagement'),

    # Posts, Comments, Moderation & Relevance Routing
    path('posts/', PostListCreateView.as_view(), name='post-list-create'),
    path('posts/<uuid:pk>/', PostDetailView.as_view(), name='post-detail'),
    path('posts/<uuid:pk>/moderate/', PostModerateView.as_view(), name='post-moderate'),
    path('posts/<uuid:pk>/comments/', CommentCreateView.as_view(), name='comment-create'),
    path('posts/<uuid:pk>/draft-comment/', DraftCommentView.as_view(), name='post-draft-comment'),

    # Notifications
    path('notifications/', NotificationListView.as_view(), name='notification-list'),
    path('notifications/unread-count/', NotificationUnreadCountView.as_view(), name='notification-unread-count'),
    path('notifications/<uuid:pk>/read/', NotificationMarkReadView.as_view(), name='notification-read'),
    path('notifications/<uuid:pk>/dismiss/', NotificationDismissView.as_view(), name='notification-dismiss'),
]
