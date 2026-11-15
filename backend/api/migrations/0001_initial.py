from django.db import migrations


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.RunSQL(
            sql="""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
                    CREATE EXTENSION IF NOT EXISTS vector;
                    RAISE NOTICE 'pgvector extension enabled successfully.';
                ELSE
                    RAISE WARNING 'pgvector extension is not available in pg_available_extensions; please install pgvector binary on PostgreSQL.';
                END IF;
            END
            $$;
            """,
            reverse_sql="DROP EXTENSION IF EXISTS vector;",
        ),
    ]
