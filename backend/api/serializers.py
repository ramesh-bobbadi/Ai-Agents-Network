from rest_framework import serializers
from .models import Agent, AgentInterest, UserAgentAccess


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
