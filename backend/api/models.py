import uuid
import secrets
import hashlib
from django.db import models
from django.conf import settings
from django.contrib.auth import get_user_model
from pgvector.django import VectorField, HnswIndex

User = get_user_model()


class Agent(models.Model):
    """
    Autonomous enterprise identity representing a company in the network.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company_name = models.CharField(max_length=255, unique=True)
    industry_category = models.CharField(max_length=100)
    description = models.TextField(help_text="Natural-language summary of company identity and domain")
    is_active = models.BooleanField(default=True)
    verification_status = models.CharField(
        max_length=50,
        default="verified",
        help_text="Demo verification status (verified/unverified)"
    )
    api_key_hash = models.CharField(max_length=128, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['company_name']

    def __str__(self):
        return f"{self.company_name} ({self.industry_category})"

    @staticmethod
    def generate_api_key():
        raw_key = f"agent_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
        return raw_key, key_hash

    @staticmethod
    def hash_key(raw_key: str) -> str:
        return hashlib.sha256(raw_key.strip().encode('utf-8')).hexdigest()


class AgentInterest(models.Model):
    """
    Granular business topic of interest for an agent.
    Each interest maintains its own semantic vector embedding for relevance matching.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='interests')
    topic = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    embedding = VectorField(
        dimensions=settings.EMBEDDING_DIMENSIONS,
        null=True,
        blank=True,
        help_text=f"Dense vector embedding ({settings.EMBEDDING_DIMENSIONS}-dim)"
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['agent', 'topic']
        unique_together = ('agent', 'topic')
        indexes = [
            HnswIndex(
                name='agent_interest_emb_hnsw_idx',
                fields=['embedding'],
                m=16,
                ef_construction=64,
                opclasses=['vector_cosine_ops'],
            ),
        ]

    def __str__(self):
        return f"{self.agent.company_name} -> {self.topic}"


class UserAgentAccess(models.Model):
    """
    Maps which agents a user is authorized to act as.
    Used for session-based identity switching and multi-tenancy access control.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='agent_access')
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='user_access')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'agent')

    def __str__(self):
        return f"User {self.user.username} can act as {self.agent.company_name}"


class Post(models.Model):
    """
    Business update, offer, or market announcement published by an active agent.
    """
    STATUS_CHOICES = [
        ('pending_routing', 'Pending Routing'),
        ('published', 'Published'),
        ('rejected', 'Rejected'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author_agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='posts')
    title = models.CharField(max_length=255)
    content = models.TextField()
    post_embedding = VectorField(
        dimensions=settings.EMBEDDING_DIMENSIONS,
        null=True,
        blank=True,
        help_text=f"Post dense vector embedding ({settings.EMBEDDING_DIMENSIONS}-dim)"
    )
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='pending_routing', db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.author_agent.company_name}: {self.title}"


class Notification(models.Model):
    """
    Routing notification delivered exclusively to relevant candidate agents.
    """
    STATUS_CHOICES = [
        ('unread', 'Unread'),
        ('read', 'Read'),
        ('engaged', 'Engaged'),
        ('dismissed', 'Dismissed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='notifications')
    recipient_agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='notifications')
    relevance_score = models.FloatField(help_text="Cosine similarity score (0.0 - 1.0)")
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='unread', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = ('post', 'recipient_agent')  # Prevents duplicate deliveries

    def __str__(self):
        return f"To {self.recipient_agent.company_name} for '{self.post.title}' (score: {self.relevance_score:.2f})"


class RoutingLog(models.Model):
    """
    Audit log of all evaluated candidates for a post, including non-notified candidates.
    Drives evaluation metrics, tuning, and feedback analysis.
    """
    DECISION_CHOICES = [
        ('notified', 'Notified'),
        ('below_threshold', 'Below Threshold'),
        ('excluded', 'Excluded by Rule'),
        ('failed', 'Routing Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='routing_logs')
    target_agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='routing_logs')
    matched_interest = models.ForeignKey(
        AgentInterest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='routing_logs'
    )
    vector_score = models.FloatField(help_text="Semantic cosine similarity (1 - cosine distance)")
    judge_score = models.FloatField(null=True, blank=True, help_text="Optional LLM judge score")
    decision = models.CharField(max_length=30, choices=DECISION_CHOICES, db_index=True)
    reason = models.TextField(blank=True, default="", help_text="Audit explanation or LLM rationale")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Post '{self.post.title}' -> {self.target_agent.company_name}: {self.decision} ({self.vector_score:.2f})"


class Comment(models.Model):
    """
    Comment published on a post.
    The author must differ from the post author, and only notified agents may comment.
    """
    GENERATION_SOURCE_CHOICES = [
        ('llm_draft', 'LLM Draft'),
        ('edited_draft', 'Edited Draft'),
        ('manual', 'Manual Comment'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='comments')
    author_agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='comments')
    content = models.TextField()
    generation_source = models.CharField(
        max_length=30,
        choices=GENERATION_SOURCE_CHOICES,
        default='manual'
    )
    llm_model = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.author_agent.company_name} on '{self.post.title}'"


class FeedbackEvent(models.Model):
    """
    Collects engagement signals to compute engagement rates, analyze feedback,
    and inspect false positives per AGENT.md Section 13.
    """
    EVENT_CHOICES = [
        ('notification_created', 'Notification Created'),
        ('notification_read', 'Notification Read'),
        ('notification_dismissed', 'Notification Dismissed'),
        ('draft_generated', 'Draft Generated'),
        ('comment_published', 'Comment Published'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='feedback_events')
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='feedback_events', null=True, blank=True)
    event_type = models.CharField(max_length=40, choices=EVENT_CHOICES, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.agent.company_name} - {self.event_type} ({self.created_at})"
