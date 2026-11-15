from django.db import connection
from django.utils import timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status


class HealthCheckView(APIView):
    """
    Health check endpoint returning system status, database connectivity,
    and pgvector extension availability.
    """
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        db_ok = False
        vector_available = False
        db_error = None

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1;")
                cursor.fetchone()
                db_ok = True

                cursor.execute(
                    "SELECT 1 FROM pg_extension WHERE extname = 'vector';"
                )
                vector_row = cursor.fetchone()
                vector_available = bool(vector_row)
        except Exception as e:
            db_error = str(e)

        overall_status = "ok" if db_ok else "degraded"

        return Response(
            {
                "status": overall_status,
                "timestamp": timezone.now().isoformat(),
                "database": {
                    "connected": db_ok,
                    "engine": connection.settings_dict.get("ENGINE", ""),
                    "error": db_error,
                },
                "pgvector": {
                    "extension_enabled": vector_available,
                    "dimension_configured": settings.EMBEDDING_DIMENSIONS,
                    "model_configured": settings.EMBEDDING_MODEL,
                },
                "channels": {
                    "backend": settings.CHANNELS_LAYER_BACKEND,
                },
            },
            status=status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        )
