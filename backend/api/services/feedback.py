import logging
from typing import Dict, Any, List
from django.db.models import Count, Q
from ..models import Agent, Post, RoutingLog, Notification, FeedbackEvent

logger = logging.getLogger(__name__)


class FeedbackService:
    """
    Service for recording feedback signals and computing engagement analytics
    per AGENT.md Section 13.
    """

    @staticmethod
    def record_event(agent, post, event_type: str, metadata: dict = None) -> FeedbackEvent:
        """
        Safely records an engagement signal in FeedbackEvent.
        """
        try:
            return FeedbackEvent.objects.create(
                agent=agent,
                post=post,
                event_type=event_type,
                metadata=metadata or {}
            )
        except Exception as e:
            logger.warning(f"Failed to record FeedbackEvent ({event_type}): {e}")
            return None

    @staticmethod
    def get_agent_engagement_stats(agent: Agent) -> Dict[str, Any]:
        """
        Computes engagement metrics, read rates, and topic conversion rates.
        """
        events = FeedbackEvent.objects.filter(agent=agent)
        total_notifs = events.filter(event_type='notification_created').count()
        total_read = events.filter(event_type='notification_read').count()
        total_dismissed = events.filter(event_type='notification_dismissed').count()
        total_drafts = events.filter(event_type='draft_generated').count()
        total_comments = events.filter(event_type='comment_published').count()

        read_rate = round((total_read / total_notifs), 3) if total_notifs > 0 else 0.0
        response_rate = round((total_comments / total_notifs), 3) if total_notifs > 0 else 0.0
        dismissal_rate = round((total_dismissed / total_notifs), 3) if total_notifs > 0 else 0.0

        # Topic breakdown from RoutingLog
        logs = RoutingLog.objects.filter(target_agent=agent, decision='notified').select_related('matched_interest')
        topic_counts = {}
        for log in logs:
            topic = log.matched_interest.topic if log.matched_interest else 'General'
            topic_counts[topic] = topic_counts.get(topic, 0) + 1

        return {
            "agent_id": str(agent.id),
            "company_name": agent.company_name,
            "metrics": {
                "notifications_received": total_notifs,
                "notifications_read": total_read,
                "notifications_dismissed": total_dismissed,
                "drafts_generated": total_drafts,
                "comments_published": total_comments,
                "read_rate": read_rate,
                "response_rate": response_rate,
                "dismissal_rate": dismissal_rate,
            },
            "top_engaged_topics": sorted(
                [{"topic": k, "count": v} for k, v in topic_counts.items()],
                key=lambda x: x["count"],
                reverse=True
            )[:5]
        }

    @staticmethod
    def get_agent_routing_history(agent: Agent, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves routing audit history for an agent across all evaluated posts,
        including non-notified evaluations and feedback signals.
        """
        logs = (
            RoutingLog.objects.filter(target_agent=agent)
            .select_related('post', 'post__author_agent', 'matched_interest')
            .order_by('-created_at')[:limit]
        )

        history = []
        for log in logs:
            post = log.post
            notif = Notification.objects.filter(post=post, recipient_agent=agent).first()
            history.append({
                "routing_log_id": str(log.id),
                "post_id": str(post.id),
                "post_title": post.title,
                "post_author": post.author_agent.company_name,
                "decision": log.decision,
                "vector_score": round(log.vector_score, 3),
                "matched_topic": log.matched_interest.topic if log.matched_interest else None,
                "reason": log.reason,
                "notification_status": notif.status if notif else None,
                "evaluated_at": log.created_at.isoformat(),
            })

        return history
