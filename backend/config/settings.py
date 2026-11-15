import os
from pathlib import Path
import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

# Load environment variables (.env from REPO_ROOT or BASE_DIR)
load_dotenv(REPO_ROOT / '.env')
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.getenv(
    'SECRET_KEY',
    'django-insecure-k_c^(e03ul%t_*kkp!8(14@#9tx15kqdeuo)qaq9bz-3*qv-_@'
)

DEBUG = os.getenv('DEBUG', 'True').lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
    if host.strip()
]

# Application definition
INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'corsheaders',
    'channels',
    # Local Apps
    'api.apps.ApiConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Database
# Default to local PostgreSQL or DATABASE_URL environment variable
DEFAULT_DB_URL = 'postgresql://postgres:dbms123@localhost:5432/agent_network'
DATABASES = {
    'default': dj_database_url.config(
        default=os.getenv('DATABASE_URL', DEFAULT_DB_URL),
        conn_max_age=600,
        ssl_require=os.getenv('DATABASE_SSL', 'False').lower() in ('true', '1'),
    )
}

# Channels Layer configuration
CHANNELS_LAYER_BACKEND = os.getenv('CHANNELS_LAYER_BACKEND', 'memory').lower()
if CHANNELS_LAYER_BACKEND == 'redis':
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [os.getenv('REDIS_URL', 'redis://127.0.0.1:6379/0')],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Django REST Framework
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
}

# CORS Configuration
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]
CORS_ALLOW_CREDENTIALS = True

# Centralized AI & Relevance Routing Settings
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL', 'text-embedding-3-small')
EMBEDDING_DIMENSIONS = int(os.getenv('EMBEDDING_DIMENSIONS', '1536'))

ROUTING_SIMILARITY_THRESHOLD = float(os.getenv('ROUTING_SIMILARITY_THRESHOLD', '0.72'))
ROUTING_TOP_K = int(os.getenv('ROUTING_TOP_K', '50'))
ENABLE_LLM_JUDGE = os.getenv('ENABLE_LLM_JUDGE', 'False').lower() in ('true', '1')
