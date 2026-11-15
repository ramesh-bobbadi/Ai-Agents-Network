import uuid
from django.test import TestCase
from django.urls import reverse
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIClient

from api.models import Agent, AgentInterest, UserAgentAccess, Post, Notification, RoutingLog
from api.services.embedding import EmbeddingService
from api.services.routing import RelevanceRoutingService

User = get_user_model()


class FoundationHealthTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_health_check_endpoint(self):
        url = reverse('health-check')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.json()
        self.assertEqual(data.get('status'), 'ok')
        self.assertTrue(data['database']['connected'])
        self.assertIn('pgvector', data)
        self.assertEqual(data['pgvector']['dimension_configured'], 1536)
        self.assertEqual(data['pgvector']['model_configured'], 'text-embedding-3-small')
        self.assertEqual(data['channels']['backend'], 'memory')

    def test_configured_settings(self):
        self.assertEqual(settings.EMBEDDING_DIMENSIONS, 1536)
        self.assertEqual(settings.EMBEDDING_MODEL, 'text-embedding-3-small')
        self.assertEqual(settings.CHANNELS_LAYER_BACKEND, 'memory')
        self.assertIn('api.apps.ApiConfig', settings.INSTALLED_APPS)
        self.assertIn('daphne', settings.INSTALLED_APPS)
        self.assertIn('channels', settings.INSTALLED_APPS)


class AgentIdentityScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='tester', password='password123')

        # Create two sample agents
        self.raw_key_1, self.key_hash_1 = Agent.generate_api_key()
        self.agent_1 = Agent.objects.create(
            company_name="Swiggy",
            industry_category="Food Delivery",
            description="Food delivery platform",
            api_key_hash=self.key_hash_1,
            verification_status="verified",
        )

        self.raw_key_2, self.key_hash_2 = Agent.generate_api_key()
        self.agent_2 = Agent.objects.create(
            company_name="Bajaj Auto",
            industry_category="Automotive",
            description="Vehicle manufacturer",
            api_key_hash=self.key_hash_2,
            verification_status="verified",
        )

        # Grant access to agent 1 only
        UserAgentAccess.objects.create(user=self.user, agent=self.agent_1)

    def test_list_agents(self):
        url = reverse('agent-list-create')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data), 2)
        company_names = [a['company_name'] for a in data]
        self.assertIn('Swiggy', company_names)
        self.assertIn('Bajaj Auto', company_names)

    def test_register_agent_returns_api_key_once(self):
        url = reverse('agent-list-create')
        payload = {
            "company_name": "Zomato",
            "industry_category": "Food Delivery",
            "description": "Restaurant discovery and food delivery",
            "initial_interests": ["dining", "quick delivery"],
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()

        # Must return raw api_key starting with 'agent_'
        self.assertIn('api_key', data)
        self.assertTrue(data['api_key'].startswith('agent_'))

        # Check DB has hashed key, not raw key
        zomato = Agent.objects.get(company_name="Zomato")
        self.assertNotEqual(zomato.api_key_hash, data['api_key'])
        self.assertEqual(zomato.interests.count(), 2)

    def test_active_agent_session_switching_and_scoping(self):
        self.client.force_login(self.user)
        url = reverse('agent-active')

        # 1. Switch to authorized agent_1 -> SUCCESS
        res = self.client.post(url, {'agent_id': str(self.agent_1.id)})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.json()['agent']['company_name'], 'Swiggy')

        # Check GET active agent
        get_res = self.client.get(url)
        self.assertEqual(get_res.status_code, status.HTTP_200_OK)
        self.assertEqual(get_res.json()['company_name'], 'Swiggy')

        # 2. Switch to unauthorized agent_2 -> FORBIDDEN (403)
        res_unauthorized = self.client.post(url, {'agent_id': str(self.agent_2.id)})
        self.assertEqual(res_unauthorized.status_code, status.HTTP_403_FORBIDDEN)

    def test_programmatic_api_key_auth(self):
        # Authenticate with valid header
        self.client.credentials(HTTP_X_AGENT_API_KEY=self.raw_key_1)
        url = reverse('health-check')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Authenticate with invalid key -> 401 or 403
        self.client.credentials(HTTP_X_AGENT_API_KEY="invalid_key_123")
        url_agents = reverse('agent-list-create')
        response_invalid = self.client.get(url_agents)
        self.assertIn(response_invalid.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])


class Phase3RoutingAndPostsTests(TestCase):
    """
    Automated evaluation and integration tests for Phase 3 Relevance Routing.
    Tests use deterministic mocked embeddings to run without paid API access.
    """
    def setUp(self):
        self.client = APIClient()
        # Seed the 5 canonical agents with deterministic embeddings
        call_command('seed_agents')

        self.swiggy = Agent.objects.get(company_name="Swiggy")
        self.phonepe = Agent.objects.get(company_name="PhonePe")
        self.hdfc = Agent.objects.get(company_name="HDFC Bank")
        self.bajaj = Agent.objects.get(company_name="Bajaj Auto")
        self.flipkart = Agent.objects.get(company_name="Flipkart")

        # Set tuned threshold for deterministic evaluation
        settings.ROUTING_SIMILARITY_THRESHOLD = 0.50

    def test_swiggy_diwali_acceptance_scenario(self):
        """
        Acceptance scenario from Section 6 & 14:
        Swiggy publishes a Diwali delivery discount ->
        Routes to PhonePe and HDFC Bank.
        MUST NOT route to Bajaj Auto.
        Author Swiggy is NEVER notified.
        """
        post = Post.objects.create(
            author_agent=self.swiggy,
            title="Diwali Food Delivery Discount",
            content="5% off all deliveries above 300 rupees during Diwali week.",
            status='pending_routing',
        )

        result = RelevanceRoutingService.route_post(post, force_mock_embeddings=True)
        self.assertTrue(result['success'])

        notified_ids = result['notified_agent_ids']

        # 1. Author Swiggy is never notified
        self.assertNotIn(str(self.swiggy.id), notified_ids)

        # 2. Bajaj Auto is not relevant to food delivery & payments -> NOT notified
        self.assertNotIn(str(self.bajaj.id), notified_ids)

        # 3. PhonePe and HDFC Bank are relevant partners -> NOTIFIED
        self.assertIn(str(self.phonepe.id), notified_ids)
        self.assertIn(str(self.hdfc.id), notified_ids)

        # 4. Routing logs are created for every candidate
        logs = RoutingLog.objects.filter(post=post)
        self.assertEqual(logs.count(), 5)

        # Author log is excluded
        swiggy_log = logs.get(target_agent=self.swiggy)
        self.assertEqual(swiggy_log.decision, 'excluded')

        # Bajaj Auto log is below_threshold
        bajaj_log = logs.get(target_agent=self.bajaj)
        self.assertEqual(bajaj_log.decision, 'below_threshold')

    def test_notification_creation_is_idempotent(self):
        """
        Re-running routing on an already routed post must not duplicate notifications.
        """
        post = Post.objects.create(
            author_agent=self.swiggy,
            title="Flash Delivery Discount",
            content="Flat 10% discount on restaurant deliveries.",
            status='pending_routing',
        )

        # First routing run
        RelevanceRoutingService.route_post(post, force_mock_embeddings=True)
        initial_notif_count = Notification.objects.filter(post=post).count()

        # Second routing run (simulating retry)
        RelevanceRoutingService.route_post(post, force_mock_embeddings=True)
        second_notif_count = Notification.objects.filter(post=post).count()

        self.assertEqual(initial_notif_count, second_notif_count)

    def test_feed_visibility_rule(self):
        """
        Feed visibility rule from Section 9:
        A post is visible to its author and to agents that received a notification for it.
        Unnotified agents cannot see it.
        """
        post = Post.objects.create(
            author_agent=self.swiggy,
            title="Diwali Delivery Discount",
            content="5% off all deliveries above 300 rupees during Diwali week.",
            status='pending_routing',
        )
        route_res = RelevanceRoutingService.route_post(post, force_mock_embeddings=True)
        self.assertIn(str(self.phonepe.id), route_res['notified_agent_ids'])

        url_feed = reverse('post-list-create')
        url_detail = reverse('post-detail', kwargs={'pk': post.id})

        # 1. Author Swiggy viewing -> VISIBLE
        session = self.client.session
        session['active_agent_id'] = str(self.swiggy.id)
        session.save()

        res_author_feed = self.client.get(url_feed)
        self.assertEqual(res_author_feed.status_code, status.HTTP_200_OK)
        post_ids = [p['id'] for p in res_author_feed.json()]
        self.assertIn(str(post.id), post_ids)

        res_author_detail = self.client.get(url_detail)
        self.assertEqual(res_author_detail.status_code, status.HTTP_200_OK)

        # 2. Notified PhonePe viewing -> VISIBLE
        session['active_agent_id'] = str(self.phonepe.id)
        session.save()

        res_phonepe_feed = self.client.get(url_feed)
        self.assertEqual(res_phonepe_feed.status_code, status.HTTP_200_OK)
        post_ids_phonepe = [p['id'] for p in res_phonepe_feed.json()]
        self.assertIn(str(post.id), post_ids_phonepe)

        # 3. Unnotified Bajaj Auto viewing -> NOT VISIBLE in feed & 403 on detail
        session['active_agent_id'] = str(self.bajaj.id)
        session.save()

        res_bajaj_feed = self.client.get(url_feed)
        self.assertEqual(res_bajaj_feed.status_code, status.HTTP_200_OK)
        post_ids_bajaj = [p['id'] for p in res_bajaj_feed.json()]
        self.assertNotIn(str(post.id), post_ids_bajaj)

        res_bajaj_detail = self.client.get(url_detail)
        self.assertEqual(res_bajaj_detail.status_code, status.HTTP_403_FORBIDDEN)

    def test_retry_pending_routing_command(self):
        """
        Management command retry_pending_routing routes stuck posts.
        """
        post = Post.objects.create(
            author_agent=self.phonepe,
            title="UPI Cashback Offer",
            content="UPI cashback of 20 rupees on merchant payments.",
            status='pending_routing',
        )
        self.assertEqual(post.status, 'pending_routing')
        self.assertEqual(Notification.objects.filter(post=post).count(), 0)

        call_command('retry_pending_routing')

        post.refresh_from_db()
        self.assertEqual(post.status, 'published')
        self.assertGreater(Notification.objects.filter(post=post).count(), 0)
