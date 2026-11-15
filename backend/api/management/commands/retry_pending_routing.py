from django.core.management.base import BaseCommand
from api.models import Post
from api.services.routing import RelevanceRoutingService


class Command(BaseCommand):
    help = "Retries relevance routing for posts stuck in pending_routing status."

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=50,
            help='Maximum number of pending posts to process in one batch.',
        )

    def handle(self, *args, **options):
        limit = options.get('limit', 50)
        pending_posts = Post.objects.filter(status='pending_routing').order_by('created_at')[:limit]
        total = pending_posts.count()

        if total == 0:
            self.stdout.write(self.style.SUCCESS("No pending_routing posts found."))
            return

        self.stdout.write(self.style.MIGRATE_HEADING(f"Retrying relevance routing for {total} pending post(s)..."))
        success_count = 0
        failed_count = 0

        for post in pending_posts:
            self.stdout.write(f"  Routing Post {post.id} ('{post.title}')...", ending="")
            result = RelevanceRoutingService.route_post(post)
            if result.get('success'):
                success_count += 1
                notified = len(result.get('notified_agent_ids', []))
                self.stdout.write(self.style.SUCCESS(f" OK ({notified} notified)"))
            else:
                failed_count += 1
                self.stdout.write(self.style.ERROR(f" FAILED: {result.get('error')}"))

        self.stdout.write(self.style.SUCCESS(f"\nRetry complete: {success_count} succeeded, {failed_count} failed."))
