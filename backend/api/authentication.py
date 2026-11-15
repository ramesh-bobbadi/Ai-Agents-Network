import hashlib
from rest_framework import authentication, exceptions
from .models import Agent, UserAgentAccess


class AgentAPIKeyAuthentication(authentication.BaseAuthentication):
    """
    Authenticates programmatic agent requests using per-agent API keys.
    Key is provided via `X-Agent-API-Key` header or `Authorization: Bearer <key>`.
    """
    def authenticate(self, request):
        api_key = request.headers.get('X-Agent-API-Key')

        if not api_key:
            auth_header = request.headers.get('Authorization', '')
            if auth_header.startswith('Bearer agent_'):
                api_key = auth_header[7:].strip()

        if not api_key:
            return None  # Pass to next authentication method

        key_hash = hashlib.sha256(api_key.strip().encode('utf-8')).hexdigest()

        try:
            agent = Agent.objects.get(api_key_hash=key_hash, is_active=True)
        except Agent.DoesNotExist:
            raise exceptions.AuthenticationFailed('Invalid or deactivated Agent API key.')

        # Store authenticated agent on the request object
        request.agent = agent
        # Return (None, None) or anonymous user with auth credentials
        return (None, agent)


def get_active_agent(request):
    """
    Resolves the active agent for the current request.
    Priority:
    1. Direct API Key authentication (`request.agent`)
    2. Header-based active agent (`X-Active-Agent-ID`)
    3. Query parameter `agent_id`
    4. Session-based active agent (`request.session['active_agent_id']`)
    """
    # 1. API key authenticated agent
    if hasattr(request, 'agent') and request.agent:
        return request.agent

    # 2. Header-based active agent (essential for cross-origin decoupled SPAs)
    active_agent_id = request.headers.get('X-Active-Agent-ID')

    # 3. Query param fallback
    if not active_agent_id:
        if hasattr(request, 'query_params'):
            active_agent_id = request.query_params.get('agent_id')
        elif hasattr(request, 'GET'):
            active_agent_id = request.GET.get('agent_id')

    # 4. Session-based active agent
    if not active_agent_id and hasattr(request, 'session'):
        active_agent_id = request.session.get('active_agent_id')

    if not active_agent_id:
        return None

    try:
        agent = Agent.objects.get(id=active_agent_id, is_active=True)
    except (Agent.DoesNotExist, ValueError):
        # Invalid or deleted agent in session
        if hasattr(request, 'session'):
            request.session.pop('active_agent_id', None)
        return None

    # Check UserAgentAccess if user is logged in and not staff
    if request.user.is_authenticated and not request.user.is_staff:
        has_access = UserAgentAccess.objects.filter(
            user=request.user, agent=agent
        ).exists()
        if not has_access:
            return None

    return agent
