import math
import hashlib
import re
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

# Canonical domain clusters for deterministic offline embedding generation
DOMAIN_CLUSTERS = {
    # Food / restaurant / quick delivery cluster
    'food': ['food', 'delivery', 'deliveries', 'restaurant', 'dining', 'groceries', 'quick commerce', 'orders'],
    # Payments / UPI / rewards cluster
    'payments': ['upi', 'cashback', 'rewards', 'payment', 'wallet', 'merchant', 'checkout', 'rupees'],
    # Banking / card / loan / EMI cluster
    'banking': ['card', 'cards', 'credit', 'debit', 'emi', 'loan', 'loans', 'bank', 'banking', 'financing'],
    # Retail / ecommerce sale cluster
    'ecommerce': ['ecommerce', 'e-commerce', 'sale', 'shopping', 'electronics', 'fashion', 'deals', 'discounts', 'billion'],
    # Auto / mobility cluster
    'automotive': ['motorcycle', 'scooter', 'scooters', 'two-wheeler', 'vehicle', 'automotive', 'dealer', 'mobility'],
}


class EmbeddingService:
    """
    Handles text embedding generation using OpenAI text-embedding-3-small,
    with a deterministic offline fallback for automated testing without API costs.
    """

    @classmethod
    def get_embedding(cls, text: str, force_mock: bool = False) -> list[float]:
        """
        Generates a 1536-dimensional float vector for the given text.
        """
        if not text or not text.strip():
            return [0.0] * settings.EMBEDDING_DIMENSIONS

        api_key = getattr(settings, 'OPENAI_API_KEY', '')

        # Use real OpenAI embeddings if API key is provided and not forced to mock
        if api_key and not force_mock:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key)
                response = client.embeddings.create(
                    input=text.strip(),
                    model=settings.EMBEDDING_MODEL,
                )
                return response.data[0].embedding
            except Exception as e:
                logger.warning(f"OpenAI embedding failed ({e}); falling back to deterministic embedding.")

        # Deterministic mock embedding generator for tests / offline use
        return cls._generate_deterministic_vector(text, dimensions=settings.EMBEDDING_DIMENSIONS)

    @classmethod
    def get_embeddings_batch(cls, texts: list[str], force_mock: bool = False) -> list[list[float]]:
        """
        Generates embeddings for multiple texts.
        """
        if not texts:
            return []

        api_key = getattr(settings, 'OPENAI_API_KEY', '')
        if api_key and not force_mock:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key)
                response = client.embeddings.create(
                    input=[t.strip() for t in texts],
                    model=settings.EMBEDDING_MODEL,
                )
                return [item.embedding for item in response.data]
            except Exception as e:
                logger.warning(f"OpenAI batch embedding failed ({e}); falling back to deterministic.")

        return [cls._generate_deterministic_vector(t, dimensions=settings.EMBEDDING_DIMENSIONS) for t in texts]

    @classmethod
    def sync_interest_embeddings(cls, agent=None, force_refresh: bool = False) -> int:
        """
        Populates vector embeddings for AgentInterest records that are missing embeddings.
        """
        from api.models import AgentInterest

        qs = AgentInterest.objects.filter(is_active=True)
        if agent:
            qs = qs.filter(agent=agent)
        if not force_refresh:
            qs = qs.filter(embedding__isnull=True)

        count = 0
        for interest in qs:
            text_payload = f"{interest.topic}: {interest.description}" if interest.description else interest.topic
            interest.embedding = cls.get_embedding(text_payload)
            interest.save(update_fields=['embedding'])
            count += 1

        logger.info(f"Synchronized embeddings for {count} AgentInterest records.")
        return count

    @staticmethod
    def _generate_deterministic_vector(text: str, dimensions: int = 1536) -> list[float]:
        """
        Generates a high-quality deterministic pseudo-semantic vector using domain keywords
        and n-gram hash projections. Ensures identical text produces identical embeddings,
        and domain-related texts produce realistic cosine similarities.
        """
        words = set(re.findall(r'\b[a-zA-Z]{3,}\b', text.lower()))
        vector = [0.0] * dimensions

        # 1. Base semantic cluster activations
        for cluster_idx, (cluster_name, keywords) in enumerate(DOMAIN_CLUSTERS.items()):
            overlap = sum(1 for kw in keywords if any(kw in word or word in kw for word in words))
            if overlap > 0:
                # Distribute signal across assigned dimension block
                block_start = (cluster_idx * 120) % dimensions
                block_size = 100
                weight = float(overlap) * 2.5
                for j in range(block_size):
                    idx = (block_start + j) % dimensions
                    vector[idx] += weight * math.cos(j * 0.1)

        # 2. Add n-gram hash projection for lexical specificity
        for word in words:
            word_hash = int(hashlib.sha256(word.encode('utf-8')).hexdigest(), 16)
            for k in range(5):
                pos = (word_hash >> (k * 8)) % dimensions
                vector[pos] += 1.0

        # 3. L2 Normalize to unit sphere (required for Cosine Similarity)
        norm = math.sqrt(sum(v * v for v in vector))
        if norm > 1e-9:
            vector = [v / norm for v in vector]
        else:
            vector[0] = 1.0  # Unit vector fallback

        return vector
