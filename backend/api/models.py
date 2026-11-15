import uuid
import secrets
import hashlib
from django.db import models
from django.conf import settings
from django.contrib.auth import get_user_model
from pgvector.django import VectorField

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
        """Generates a raw key and its SHA-256 hash."""
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
