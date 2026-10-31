import logging
import secrets
import stat
import uuid
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

INSECURE_SECRET_VALUES = {
    "",
    "change-me-in-production",
    "your-secret-key-change-in-production",
    "dev-secret-key",
}

DEFAULT_AGENT_ID_FILE = "/app/data/.agent_id"
DEFAULT_AGENT_MAX_TOKENS = 1024
DEFAULT_AGENT_SIMILARITY_THRESHOLD = 0.01  # KB hybrid search scores; default 10% (0.01)


def _is_missing_or_insecure_secret(value: str | None) -> bool:
    normalized = (value or "").strip()
    return not normalized or normalized in INSECURE_SECRET_VALUES


def _load_secret_key_from_file(secret_key_file: str) -> str | None:
    try:
        path = Path(secret_key_file)
        if not path.exists():
            return None

        secret_key = path.read_text(encoding="utf-8").strip()
        return secret_key or None
    except Exception as exc:
        logger.warning("Failed to load secret key from %s: %s", secret_key_file, exc)
        return None


def _generate_and_save_secret_key(secret_key_file: str) -> str:
    secret_key = secrets.token_urlsafe(32)
    path = Path(secret_key_file)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secret_key, encoding="utf-8")
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        logger.info("Generated SECRET_KEY file at %s", secret_key_file)
    except Exception as exc:
        logger.warning(
            "Failed to persist generated SECRET_KEY to %s: %s. Using an in-memory fallback.",
            secret_key_file,
            exc,
        )

    return secret_key


def _is_valid_agent_id(value: str | None) -> bool:
    normalized = (value or "").strip()
    if not normalized.startswith("agt_"):
        return False
    suffix = normalized[4:]
    return len(suffix) == 12 and all(char in "0123456789abcdef" for char in suffix)


def _load_agent_id_from_file(agent_id_file: str) -> str | None:
    try:
        path = Path(agent_id_file)
        if not path.exists():
            return None

        agent_id = path.read_text(encoding="utf-8").strip()
        return agent_id if _is_valid_agent_id(agent_id) else None
    except Exception as exc:
        logger.warning("Failed to load agent id from %s: %s", agent_id_file, exc)
        return None


def _save_agent_id(agent_id_file: str, agent_id: str) -> None:
    path = Path(agent_id_file)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(agent_id, encoding="utf-8")
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except Exception as exc:
        logger.warning(
            "Failed to persist agent id to %s: %s.",
            agent_id_file,
            exc,
        )


def _generate_and_save_agent_id(agent_id_file: str) -> str:
    agent_id = f"agt_{uuid.uuid4().hex[:12]}"
    _save_agent_id(agent_id_file, agent_id)
    logger.info("Generated default agent id file at %s", agent_id_file)
    return agent_id


class Settings(BaseSettings):
    """应用配置"""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="allow",
    )

    # DeepSeek API (optional - can be set per-agent in dashboard)
    deepseek_api_key: str = ""

    # Jina Embedding API
    jina_embedding_api_base: str = "https://api.jina.ai/v1/embeddings"

    # Local (self-hosted) embedding provider — a Text Embeddings Inference container
    # exposing the OpenAI-compatible /v1/embeddings endpoint on the compose network.
    # The `local` KB provider uses these as its defaults; no API key involved.
    local_embedding_base_url: str = "http://local-embed:80/v1"
    local_embedding_model: str = "ibm-granite/granite-embedding-97m-multilingual-r2"

    # Scrapling 微服务
    scrapling_service_url: str = "http://scrapling-service:8001"
    scraping_provider: str = "local_scrapling"
    cloud_scraping_api_url: str = ""
    cloud_scraping_api_key: str = ""
    scraping_timeout_seconds: int = 60
    scraping_agent_concurrency: int = 2
    scraping_workspace_concurrency: int = 6
    scraping_fallback_to_cloud: bool = False

    # 数据库 - SQLite (轻量级MVP方案)
    database_url: str = "sqlite:///./data/basjoo.db"

    # Redis 配置
    redis_url: str = "redis://redis:6379/0"
    redis_cache_ttl: int = 3600  # 缓存过期时间（秒）
    redis_rate_limit_ttl: int = 60  # 限流窗口（秒）

    # Qdrant 向量数据库配置
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_timeout: float = 30.0

    # JWT 认证
    secret_key: str = ""
    secret_key_file: str = "/app/data/.secret_key"
    default_agent_id: str = ""
    agent_id_file: str = DEFAULT_AGENT_ID_FILE
    create_default_agent_on_bootstrap: bool = False
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440

    # LLM / Embedding reliability
    llm_test_timeout_seconds: int = 10
    llm_retry_attempts: int = 3
    llm_retry_base_delay_seconds: float = 1.0
    llm_retry_max_delay_seconds: float = 8.0
    embedding_cache_max_entries: int = 1000
    embedding_cache_trim_count: int = 200

    # CORS 配置
    # 生产环境建议配置具体域名，例如 "https://example.com,https://app.example.com"
    # 使用 * 允许所有来源，适用于公开的无凭证接口
    allowed_origins: str = "*"
    allowed_methods: str = "GET,POST,PUT,DELETE,OPTIONS"
    allowed_headers: str = "Content-Type,Authorization,X-Requested-With,Accept"

    # Whether to allow wildcard CORS for Origin: null (e.g., file:// widget preview).
    # Off by default; enable explicitly in dev environments.
    cors_allow_null_origin: bool = False

    # SSRF protection on user-supplied ingest URLs (see services/url_safety.py).
    # Off by default: a host whose resolver answers with fake-ip / ULA addresses
    # (sing-box, clash, split-horizon DNS) would otherwise have every real fetch
    # rejected as "Resolved to blocked IP". Turn it on where the deployment is
    # exposed to untrusted users and guards its own metadata/internal network.
    ssrf_protection_enabled: bool = False

    # The address visitors actually reach (#40). Every public, unauthenticated
    # surface — `/api/v1/config:public` and `/api/v1/agents/{id}/embed.js` —
    # answers with this origin when it is set, so a dashboard opened on
    # `localhost` hands out a public snippet instead of a loopback one.
    # Empty (the default) means: trust `X-Forwarded-Host`, then `Host`.
    public_base_url: str = ""

    # 应用
    app_name: str = "Basjoo"
    app_port: int = 8000

    # 限流
    default_rate_limit: int = 100
    rate_limit_per_minute: int = 1000
    rate_limit_burst_size: int = 200

    # Login rate limit
    login_rate_limit_max_attempts: int = 5
    login_rate_limit_window_seconds: int = 300

    # Reverse proxies whose forwarded headers may be believed (comma-separated
    # IPs). X-Forwarded-For / X-Real-IP are client-controlled unless the
    # immediate peer is one of these, so empty (the default) trusts nothing and
    # every limiter keys on the socket peer address. The deployed nginx sets
    # X-Real-IP and X-Forwarded-For; point this at the nginx container to keep
    # per-visitor accounting there.
    trusted_proxy_ips: str = ""

    # 日志
    log_level: str = "info"

    # #41 — transcript email. Absent host/from means "SMTP is not configured",
    # which the route answers as a 503 instead of a 500. `SMTP_USE_TLS` defaults
    # to on (STARTTLS); the sender falls back to `SMTP_USER`.
    smtp_host: str = ""
    smtp_port: str = "587"
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: str = "true"

    def model_post_init(self, __context) -> None:
        secret_key_file = self.secret_key_file.strip() or "/app/data/.secret_key"
        object.__setattr__(self, "secret_key_file", secret_key_file)

        agent_id_file = self.agent_id_file.strip() or DEFAULT_AGENT_ID_FILE
        object.__setattr__(self, "agent_id_file", agent_id_file)

        if not self.allowed_origins.strip():
            # No wildcard by default — deployments must explicitly set ALLOWED_ORIGINS.
            object.__setattr__(self, "allowed_origins", "")

        if not self.allowed_methods.strip():
            object.__setattr__(self, "allowed_methods", "GET,POST,PUT,DELETE,OPTIONS")

        if not self.allowed_headers.strip():
            object.__setattr__(
                self,
                "allowed_headers",
                "Content-Type,Authorization,X-Requested-With,Accept",
            )

        # A trailing slash is a typo, not a path: the origin is the prefix every
        # snippet is concatenated onto, so `https://x/` would render `//api`.
        object.__setattr__(
            self, "public_base_url", self.public_base_url.strip().rstrip("/")
        )

        if _is_missing_or_insecure_secret(self.secret_key):
            resolved_secret = _load_secret_key_from_file(secret_key_file)
            if not resolved_secret:
                resolved_secret = _generate_and_save_secret_key(secret_key_file)
            object.__setattr__(self, "secret_key", resolved_secret)

        resolved_agent_id = self.default_agent_id.strip()
        if resolved_agent_id and not _is_valid_agent_id(resolved_agent_id):
            logger.warning(
                "Ignoring invalid DEFAULT_AGENT_ID %r. Expected format agt_<12 lowercase hex chars>.",
                resolved_agent_id,
            )
            resolved_agent_id = ""

        if resolved_agent_id:
            _save_agent_id(agent_id_file, resolved_agent_id)
        else:
            file_agent_id = _load_agent_id_from_file(agent_id_file)
            if file_agent_id:
                resolved_agent_id = file_agent_id
            else:
                resolved_agent_id = _generate_and_save_agent_id(agent_id_file)

        object.__setattr__(self, "default_agent_id", resolved_agent_id)

    @property
    def trusted_proxy_ips_list(self) -> list[str]:
        """将逗号分隔的可信代理 IP 转换为列表"""
        return [
            ip.strip()
            for ip in self.trusted_proxy_ips.split(",")
            if ip.strip()
        ]

    @property
    def cors_origins_list(self) -> list[str]:
        """将逗号分隔的字符串转换为列表"""
        return [
            origin.strip()
            for origin in self.allowed_origins.split(",")
            if origin.strip()
        ]

    @property
    def cors_methods_list(self) -> list[str]:
        """将逗号分隔的HTTP方法转换为列表"""
        methods = [
            method.strip()
            for method in self.allowed_methods.split(",")
            if method.strip()
        ]
        return methods or ["GET", "POST", "PUT", "DELETE", "OPTIONS"]

    @property
    def cors_headers_list(self) -> list[str]:
        """将逗号分隔的请求头转换为列表"""
        headers = [
            header.strip()
            for header in self.allowed_headers.split(",")
            if header.strip()
        ]
        return headers or [
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "Accept",
        ]


@lru_cache
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


settings = get_settings()
