from django.test import TestCase
from django.urls import reverse
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient


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
