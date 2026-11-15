import uuid
from django.test import TestCase
from django.urls import reverse
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from api.models import Agent, AgentInterest, UserAgentAccess
from api.authentication import get_active_agent

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
