import time
from django.core.management.base import BaseCommand
from django.conf import settings
from api.models import Agent, Post, Notification
from api.evaluation.dataset import EVALUATION_SCENARIOS
from api.services.routing import RelevanceRoutingService


class Command(BaseCommand):
    help = "Evaluates relevance routing performance across the canonical Section 7 benchmark dataset."

    def add_arguments(self, parser):
        parser.add_argument(
            '--threshold',
            type=float,
            default=None,
            help='Similarity threshold to evaluate (overrides settings.ROUTING_SIMILARITY_THRESHOLD).',
        )
        parser.add_argument(
            '--force-mock',
            action='store_true',
            help='Force deterministic offline embeddings without calling external APIs.',
        )
        parser.add_argument(
            '--no-cleanup',
            action='store_true',
            help='Keep evaluation posts in the database after execution.',
        )

    def handle(self, *args, **options):
        threshold_arg = options.get('threshold')
        force_mock = options.get('force_mock', False)
        no_cleanup = options.get('no_cleanup', False)

        original_threshold = settings.ROUTING_SIMILARITY_THRESHOLD
        if threshold_arg is not None:
            settings.ROUTING_SIMILARITY_THRESHOLD = threshold_arg

        active_threshold = settings.ROUTING_SIMILARITY_THRESHOLD
        mode_str = "Deterministic Offline Mock" if force_mock or not settings.OPENAI_API_KEY else "OpenAI text-embedding-3-small"

        self.stdout.write(self.style.MIGRATE_HEADING("=================================================================="))
        self.stdout.write(self.style.MIGRATE_HEADING(f"Relevance Routing Benchmark Evaluation (Threshold: {active_threshold:.3f})"))
        self.stdout.write(self.style.MIGRATE_HEADING(f"Embedding Engine: {mode_str}"))
        self.stdout.write(self.style.MIGRATE_HEADING("=================================================================="))

        total_true_positives = 0
        total_false_positives = 0
        total_false_negatives = 0
        latencies = []
        created_post_ids = []

        for scenario in EVALUATION_SCENARIOS:
            author = Agent.objects.filter(company_name=scenario['author_company']).first()
            if not author:
                self.stdout.write(self.style.ERROR(f"[-] Author '{scenario['author_company']}' not found. Run seed_agents first."))
                continue

            # Create test post
            post = Post.objects.create(
                author_agent=author,
                title=f"[EVAL] {scenario['title']}",
                content=scenario['content'],
                status='pending_routing',
            )
            created_post_ids.append(post.id)

            t0 = time.perf_counter()
            result = RelevanceRoutingService.route_post(post, force_mock_embeddings=force_mock)
            t1 = time.perf_counter()
            latencies.append((t1 - t0) * 1000)

            # Notified companies
            notified_ids = result.get('notified_agent_ids', [])
            notified_names = set(
                Agent.objects.filter(id__in=notified_ids).values_list('company_name', flat=True)
            )

            expected = set(scenario['expected_recipients'])
            unexpected = set(scenario['unexpected_recipients'])
            borderline = set(scenario.get('borderline_recipients', []))

            # Metrics for this post
            tp = notified_names.intersection(expected)
            fn = expected.difference(notified_names)
            fp = notified_names.intersection(unexpected)

            total_true_positives += len(tp)
            total_false_negatives += len(fn)
            total_false_positives += len(fp)

            self.stdout.write(f"\nScenario: {author.company_name} -> '{scenario['title']}' ({latencies[-1]:.1f}ms)")
            self.stdout.write(f"  Expected:    {list(expected)}")
            self.stdout.write(f"  Notified:    {list(notified_names)}")
            if borderline:
                borderline_got = notified_names.intersection(borderline)
                self.stdout.write(f"  Borderline:  {list(borderline)} -> {'Notified' if borderline_got else 'Not Notified'}")

            # Logs & scores breakdown
            logs = post.routing_logs.all()
            for log in logs:
                agent_name = log.target_agent.company_name
                status_symbol = "[+]" if log.decision == 'notified' else "[-]"
                topic = f" ({log.matched_interest.topic})" if log.matched_interest else ""
                self.stdout.write(f"    {status_symbol} {agent_name:10}: score={log.vector_score:.3f}{topic} => {log.decision}")

            if fn:
                self.stdout.write(self.style.WARNING(f"  False Negatives (Missed): {list(fn)}"))
            if fp:
                self.stdout.write(self.style.ERROR(f"  False Positives (Spam):   {list(fp)}"))

        # Overall summary metrics
        total_retrieved = total_true_positives + total_false_positives
        total_relevant = total_true_positives + total_false_negatives

        precision = (total_true_positives / total_retrieved) if total_retrieved > 0 else 0.0
        recall = (total_true_positives / total_relevant) if total_relevant > 0 else 0.0
        f1_score = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        avg_latency = sum(latencies) / len(latencies) if latencies else 0.0

        self.stdout.write(self.style.MIGRATE_HEADING("\n=================== BENCHMARK REPORT ==================="))
        self.stdout.write(f"  Active Threshold:       {active_threshold:.3f}")
        self.stdout.write(f"  True Positives (TP):    {total_true_positives}")
        self.stdout.write(f"  False Positives (FP):   {total_false_positives}")
        self.stdout.write(f"  False Negatives (FN):   {total_false_negatives}")
        self.stdout.write(f"  Measured Precision:     {precision * 100:.1f}%")
        self.stdout.write(f"  Measured Recall:        {recall * 100:.1f}%")
        self.stdout.write(f"  Measured F1-Score:      {f1_score * 100:.1f}%")
        self.stdout.write(f"  Mean Routing Latency:   {avg_latency:.1f} ms")
        self.stdout.write(self.style.MIGRATE_HEADING("========================================================\n"))

        # Cleanup evaluation posts unless flagged
        if not no_cleanup and created_post_ids:
            Post.objects.filter(id__in=created_post_ids).delete()

        # Restore original settings
        settings.ROUTING_SIMILARITY_THRESHOLD = original_threshold
