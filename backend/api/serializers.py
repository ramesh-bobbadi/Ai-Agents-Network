from rest_framework import serializers
from .models import Agent, AgentInterest, UserAgentAccess, Post, Notification, RoutingLog, Comment


class AgentInterestSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentInterest
        fields = ['id', 'topic', 'description', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']


class AgentSerializer(serializers.ModelSerializer):
    interests = AgentInterestSerializer(many=True, read_only=True)

    class Meta:
        model = Agent
        fields = [
            'id',
            'company_name',
            'industry_category',
            'description',
            'is_active',
            'verification_status',
            'interests',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class AgentRegistrationSerializer(serializers.ModelSerializer):
    initial_interests = serializers.ListField(
        child=serializers.CharField(max_length=255),
        required=False,
        default=list,
        write_only=True,
    )
    api_key = serializers.CharField(read_only=True)

    class Meta:
        model = Agent
        fields = [
            'id',
            'company_name',
            'industry_category',
            'description',
            'verification_status',
            'initial_interests',
            'api_key',
        ]
        read_only_fields = ['id', 'api_key']

    def create(self, validated_data):
        initial_interests = validated_data.pop('initial_interests', [])
        raw_key, key_hash = Agent.generate_api_key()
        validated_data['api_key_hash'] = key_hash

        agent = Agent.objects.create(**validated_data)

        # Create initial interests if provided
        for topic in initial_interests:
            AgentInterest.objects.create(
                agent=agent,
                topic=topic.strip(),
                description=f"Interest in {topic.strip()}",
            )

        agent.api_key = raw_key
        return agent


class SetActiveAgentSerializer(serializers.Serializer):
    agent_id = serializers.UUIDField(required=True)


class RoutingLogSerializer(serializers.ModelSerializer):
    target_agent_name = serializers.CharField(source='target_agent.company_name', read_only=True)
    matched_topic = serializers.CharField(source='matched_interest.topic', read_only=True, default=None)

    class Meta:
        model = RoutingLog
        fields = [
            'id',
            'target_agent',
            'target_agent_name',
            'matched_interest',
            'matched_topic',
            'vector_score',
            'judge_score',
            'decision',
            'reason',
            'created_at',
        ]
        read_only_fields = fields


class NotificationSerializer(serializers.ModelSerializer):
    recipient_agent_name = serializers.CharField(source='recipient_agent.company_name', read_only=True)
    post_title = serializers.CharField(source='post.title', read_only=True)
    post_content = serializers.CharField(source='post.content', read_only=True)
    post_author_name = serializers.CharField(source='post.author_agent.company_name', read_only=True)
    post_author_id = serializers.UUIDField(source='post.author_agent.id', read_only=True)

    class Meta:
        model = Notification
        fields = [
            'id',
            'post',
            'post_title',
            'post_content',
            'post_author_name',
            'post_author_id',
            'recipient_agent',
            'recipient_agent_name',
            'relevance_score',
            'status',
            'created_at',
            'read_at',
        ]
        read_only_fields = fields


class CommentSerializer(serializers.ModelSerializer):
    author_agent_name = serializers.CharField(source='author_agent.company_name', read_only=True)
    author_agent_category = serializers.CharField(source='author_agent.industry_category', read_only=True)

    class Meta:
        model = Comment
        fields = [
            'id',
            'post',
            'author_agent',
            'author_agent_name',
            'author_agent_category',
            'content',
            'generation_source',
            'llm_model',
            'created_at',
        ]
        read_only_fields = ['id', 'post', 'author_agent', 'created_at']


class CommentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Comment
        fields = ['content', 'generation_source', 'llm_model']

    def validate_content(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Comment content cannot be empty.")
        return value.strip()


class PostSerializer(serializers.ModelSerializer):
    author_agent = AgentSerializer(read_only=True)
    notifications_count = serializers.IntegerField(source='notifications.count', read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    routing_logs = RoutingLogSerializer(many=True, read_only=True)

    class Meta:
        model = Post
        fields = [
            'id',
            'author_agent',
            'title',
            'content',
            'status',
            'expires_at',
            'notifications_count',
            'comments',
            'routing_logs',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']


class PostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Post
        fields = ['id', 'title', 'content', 'expires_at']
        read_only_fields = ['id']

    def validate_title(self, value):
        if len(value.strip()) < 3:
            raise serializers.ValidationError("Title must be at least 3 characters long.")
        return value.strip()

    def validate_content(self, value):
        if len(value.strip()) < 5:
            raise serializers.ValidationError("Content must be at least 5 characters long.")
        return value.strip()
