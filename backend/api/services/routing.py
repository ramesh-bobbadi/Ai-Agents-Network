import logging
from django.db import transaction
from django.conf import settings
from pgvector.django import CosineDistance

from api.models import Agent, AgentInterest, Post, Notification, RoutingLog
from api.services.embedding import EmbeddingService

logger = logging.getLogger(__name__)


class LLMJudgeInterface:
    """
    Interface for optional Stage 4 LLM reranker / judge.
    Returns (verdict: bool, score: float, rationale: str).
    """
    @classmethod
    def evaluate(cls, post: Post, agent: Agent, interest: AgentInterest, vector_score: float) -> tuple[bool, float, str]:
        if not getattr(settings, 'ENABLE_LLM_JUDGE', False):
            return True, vector_score, "LLM judge disabled by configuration."

        # Optional LLM call if enabled
        api_key = getattr(settings, 'OPENAI_API_KEY', '')
        if not api_key:
            return True, vector_score, "LLM judge enabled but no OpenAI key supplied; passing vector score."

        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            prompt = (
                f"Post Title: {post.title}\n"
                f"Post Content: {post.content}\n"
                f"Candidate Company: {agent.company_name} ({agent.industry_category})\n"
                f"Matched Interest: {interest.topic} - {interest.description}\n\n"
                "Would this candidate company plausibly engage or collaborate on this post? "
                "Respond in JSON format: {\"engage\": boolean, \"score\": float between 0.0 and 1.0, \"reason\": string}"
            )
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are an enterprise partnership relevance judge."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                max_tokens=150,
            )
            import json
            res_data = json.loads(response.choices[0].message.content)
            return (
                bool(res_data.get('engage', True)),
                float(res_data.get('score', vector_score)),
                str(res_data.get('reason', 'LLM judge approved candidate.')),
            )
        except Exception as e:
            logger.warning(f"LLM judge evaluation failed: {e}; falling back to vector score.")
            return True, vector_score, f"LLM judge fallback: {e}"


class RelevanceRoutingService:
    """
    Core Multi-Stage Relevance Routing Engine:
    1. SQL Eligibility Filter: exclude author, inactive, unverified.
    2. Semantic Retrieval (pgvector): HNSW cosine similarity across all interest embeddings.
    3. Score Thresholding: cosine similarity >= ROUTING_SIMILARITY_THRESHOLD.
    4. Optional LLM Judge reranking.
    5. Persistence & Notifications inside an atomic transaction.
    """

    @classmethod
    def route_post(cls, post: Post, force_mock_embeddings: bool = False) -> dict:
        """
        Executes relevance routing for a single post.
        Ensures transactions are never held across external embedding network calls.
        """
        # Step 0: Generate post embedding before opening database transaction
        post_text = f"{post.title}\n\n{post.content}".strip()
        try:
            if not post.post_embedding:
                post.post_embedding = EmbeddingService.get_embedding(
                    post_text, force_mock=force_mock_embeddings
                )
        except Exception as e:
            logger.error(f"Failed to generate embedding for Post {post.id}: {e}")
            post.status = 'pending_routing'
            post.save(update_fields=['status'])
            return {
                "success": False,
                "error": str(e),
                "notified_agents": [],
                "post_status": "pending_routing"
            }

        # Step 1: Eligibility filters (SQL)
        eligible_agents = Agent.objects.filter(
            is_active=True,
            verification_status='verified'
        ).exclude(id=post.author_agent_id)

        all_agents = Agent.objects.all()
        threshold = getattr(settings, 'ROUTING_SIMILARITY_THRESHOLD', 0.72)
        top_k = getattr(settings, 'ROUTING_TOP_K', 50)

        # Step 2: Semantic retrieval (pgvector CosineDistance on AgentInterest)
        # Cosine distance in pgvector: 0.0 is identical, 2.0 is opposite.
        # Similarity = 1.0 - distance
        matching_interests = (
            AgentInterest.objects.filter(
                agent__in=eligible_agents,
                is_active=True,
                embedding__isnull=False
            )
            .annotate(distance=CosineDistance('embedding', post.post_embedding))
            .order_by('distance')[:top_k]
        )

        # Aggregate: keep each agent's best-matching interest
        best_candidate_matches: dict[str, dict] = {}
        for item in matching_interests:
            similarity = max(0.0, min(1.0, 1.0 - float(item.distance)))
            agent_id = str(item.agent_id)
            if agent_id not in best_candidate_matches or similarity > best_candidate_matches[agent_id]['similarity']:
                best_candidate_matches[agent_id] = {
                    'agent': item.agent,
                    'interest': item,
                    'similarity': similarity,
                    'distance': float(item.distance),
                }

        # Step 3 & 4: Decisions & Optional LLM Judge
        routing_decisions = []
        notified_agent_ids = []

        for agent in all_agents:
            agent_id_str = str(agent.id)

            # Rule check: Author is never notified
            if agent.id == post.author_agent_id:
                routing_decisions.append({
                    'target_agent': agent,
                    'matched_interest': None,
                    'vector_score': 0.0,
                    'judge_score': None,
                    'decision': 'excluded',
                    'reason': 'Author agent excluded from routing notifications.',
                })
                continue

            # Rule check: Inactive or unverified
            if not agent.is_active or agent.verification_status != 'verified':
                routing_decisions.append({
                    'target_agent': agent,
                    'matched_interest': None,
                    'vector_score': 0.0,
                    'judge_score': None,
                    'decision': 'excluded',
                    'reason': f"Agent eligibility excluded: active={agent.is_active}, verification={agent.verification_status}",
                })
                continue

            # Check semantic match
            match = best_candidate_matches.get(agent_id_str)
            if not match:
                routing_decisions.append({
                    'target_agent': agent,
                    'matched_interest': None,
                    'vector_score': 0.0,
                    'judge_score': None,
                    'decision': 'below_threshold',
                    'reason': 'No matching interests retrieved in semantic ANN search.',
                })
                continue

            score = match['similarity']
            interest = match['interest']

            if score < threshold:
                routing_decisions.append({
                    'target_agent': agent,
                    'matched_interest': interest,
                    'vector_score': score,
                    'judge_score': None,
                    'decision': 'below_threshold',
                    'reason': f"Score {score:.3f} below similarity threshold {threshold:.3f} for topic '{interest.topic}'.",
                })
                continue

            # Stage 4: Optional LLM Judge
            judge_verdict, judge_score, judge_reason = LLMJudgeInterface.evaluate(
                post, agent, interest, score
            )

            if not judge_verdict:
                routing_decisions.append({
                    'target_agent': agent,
                    'matched_interest': interest,
                    'vector_score': score,
                    'judge_score': judge_score,
                    'decision': 'below_threshold',
                    'reason': f"LLM Judge rejected: {judge_reason}",
                })
                continue

            # Qualified for notification
            routing_decisions.append({
                'target_agent': agent,
                'matched_interest': interest,
                'vector_score': score,
                'judge_score': judge_score,
                'decision': 'notified',
                'reason': f"Matched topic '{interest.topic}' with similarity {score:.3f} >= threshold {threshold:.3f}. {judge_reason}",
            })
            notified_agent_ids.append(agent.id)

        # Step 5: Persist post, routing logs, and notifications atomically
        with transaction.atomic():
            post.status = 'published'
            post.save()

            notifications_created = []
            for item in routing_decisions:
                # Save RoutingLog for EVERY evaluated candidate
                RoutingLog.objects.create(
                    post=post,
                    target_agent=item['target_agent'],
                    matched_interest=item['matched_interest'],
                    vector_score=item['vector_score'],
                    judge_score=item['judge_score'],
                    decision=item['decision'],
                    reason=item['reason'],
                )

                if item['decision'] == 'notified':
                    notif, created = Notification.objects.get_or_create(
                        post=post,
                        recipient_agent=item['target_agent'],
                        defaults={
                            'relevance_score': item['vector_score'],
                            'status': 'unread',
                        }
                    )
                    notifications_created.append(notif)

            # Trigger real-time WebSocket signals post-commit
            transaction.on_commit(lambda: cls._emit_realtime_notifications(notifications_created))

        return {
            "success": True,
            "post_id": str(post.id),
            "post_status": post.status,
            "threshold": threshold,
            "notified_agent_ids": [str(a_id) for a_id in notified_agent_ids],
            "routing_logs_count": len(routing_decisions),
        }

    @staticmethod
    def _emit_realtime_notifications(notifications: list[Notification]):
        """
        Emits notification event to each recipient agent's Channels group.
        Runs safely after database transaction commits.
        """
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync

            channel_layer = get_channel_layer()
            if not channel_layer:
                return

            for notif in notifications:
                group_name = f"agent_{notif.recipient_agent_id}"
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {
                        "type": "notification.message",
                        "notification_id": str(notif.id),
                        "post_id": str(notif.post_id),
                        "post_title": notif.post.title,
                        "relevance_score": notif.relevance_score,
                    }
                )
        except Exception as e:
            logger.warning(f"WebSocket notification broadcast skipped/failed: {e}")
