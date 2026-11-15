import json
import logging
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async

logger = logging.getLogger(__name__)


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for real-time notification push signals.
    Enforces active-agent identity verification:
    Joins Channels group `agent_{active_agent_id}`.
    Emits small refresh events when notifications arrive.
    """

    async def connect(self):
        self.agent_id = await self._resolve_agent_identity()
        if not self.agent_id:
            logger.warning("Rejecting WebSocket connection: No active agent selected or unauthorized.")
            await self.close(code=4003)
            return

        self.group_name = f"agent_{self.agent_id}"

        # Join the agent's notification group
        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name
        )
        await self.accept()

        # Send initial connection acknowledgment
        await self.send_json({
            "type": "connection_established",
            "agent_id": str(self.agent_id),
            "group": self.group_name,
            "message": "Connected to real-time notification stream."
        })

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(
                self.group_name,
                self.channel_name
            )

    async def receive_json(self, content):
        """
        Handle incoming messages from client (e.g. ping or identity switch)
        """
        msg_type = content.get('type')
        if msg_type == 'ping':
            await self.send_json({"type": "pong"})
        elif msg_type == 'switch_agent':
            new_agent_id = content.get('agent_id')
            if new_agent_id and await self._verify_agent(new_agent_id):
                # Discard previous group
                if hasattr(self, 'group_name'):
                    await self.channel_layer.group_discard(
                        self.group_name,
                        self.channel_name
                    )
                self.agent_id = str(new_agent_id)
                self.group_name = f"agent_{self.agent_id}"
                await self.channel_layer.group_add(
                    self.group_name,
                    self.channel_name
                )
                await self.send_json({
                    "type": "identity_switched",
                    "agent_id": self.agent_id,
                    "group": self.group_name
                })

    async def notification_message(self, event):
        """
        Handler for 'notification.message' group broadcasts from RelevanceRoutingService.
        Pushes a small lightweight event to trigger client REST refetch.
        """
        await self.send_json({
            "type": "notification",
            "notification_id": event.get("notification_id"),
            "post_id": event.get("post_id"),
            "post_title": event.get("post_title"),
            "relevance_score": event.get("relevance_score"),
        })

    @database_sync_to_async
    def _resolve_agent_identity(self):
        from .models import Agent, UserAgentAccess
        
        # 1. Try session first
        session = self.scope.get('session')
        agent_id = None
        if session:
            agent_id = session.get('active_agent_id')

        # 2. Fall back to query string `?agent_id=...`
        if not agent_id:
            query_string = self.scope.get('query_string', b'').decode('utf-8')
            params = parse_qs(query_string)
            if 'agent_id' in params:
                agent_id = params['agent_id'][0]

        if not agent_id:
            return None

        # Verify active agent in database
        try:
            agent = Agent.objects.filter(id=agent_id, is_active=True).first()
            if not agent:
                return None

            user = self.scope.get('user')
            if user and user.is_authenticated and not user.is_staff:
                has_access = UserAgentAccess.objects.filter(user=user, agent=agent).exists()
                if not has_access:
                    return None

            return str(agent.id)
        except Exception as e:
            logger.error(f"Error resolving agent identity for WS: {e}")
            return None

    @database_sync_to_async
    def _verify_agent(self, agent_id):
        from .models import Agent
        try:
            return Agent.objects.filter(id=agent_id, is_active=True).exists()
        except Exception:
            return False
