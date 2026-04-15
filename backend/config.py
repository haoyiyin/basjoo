import logging
import secrets
import stat
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Optional

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
DEFAULT_AGENT_SIMILARITY_THRESHOLD = 0.3


def _is_missing_or_insecure_secret(value: Optional[str]) -> bool:
    normalized = (value or "").strip()
    return not normalized or normalized in INSECURE_SECRET_VALUES


def _load_secret_key_from_file(secret_key_file: str) -> Optional[str]:
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


def _is_valid_agent_id(value: Optional[str]) -> bool:
    normalized = (value or "").strip()
    if not normalized.startswith("agt_"):
        return False
    suffix = normalized[4:]
    return len(suffix) == 12 and all(char in "0123456789abcdef" for char in suffix)



def _load_agent_id_from_file(agent_id_file: str) -> Optional[str]:
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

    # 数据库 - SQLite (轻量级MVP方案)
    database_url: str = "sqlite:///./data/basjoo.db"

    # Redis 配置
    redis_url: str = "redis://redis:6379/0"
    redis_cache_ttl: int = 3600  # 缓存过期时间（秒）
    redis_rate_limit_ttl: int = 60  # 限流窗口（秒）

    # Qdrant 向量数据库配置
    qdrant_host: str = "qdrant"
    qdrant_port: int = 6333
    qdrant_api_key: Optional[str] = None  # 可选的 API Key
    qdrant_path: Optional[str] = None  # 本地Qdrant存储路径

    # JWT 认证
    secret_key: str = ""
    secret_key_file: str = "/app/data/.secret_key"
    default_agent_id: str = ""
    agent_id_file: str = DEFAULT_AGENT_ID_FILE
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

    # 应用
    app_name: str = "Basjoo"
    app_port: int = 8000

    # 限流
    default_rate_limit: int = 100
    rate_limit_per_minute: int = 1000
    rate_limit_burst_size: int = 200

    # 日志
    log_level: str = "info"

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
            object.__setattr__(self, "allowed_headers", "Content-Type,Authorization,X-Requested-With,Accept")

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
    def cors_origins_list(self) -> list[str]:
        """将逗号分隔的字符串转换为列表"""
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def cors_methods_list(self) -> list[str]:
        """将逗号分隔的HTTP方法转换为列表"""
        methods = [method.strip() for method in self.allowed_methods.split(",") if method.strip()]
        return methods or ["GET", "POST", "PUT", "DELETE", "OPTIONS"]

    @property
    def cors_headers_list(self) -> list[str]:
        """将逗号分隔的请求头转换为列表"""
        headers = [header.strip() for header in self.allowed_headers.split(",") if header.strip()]
        return headers or ["Content-Type", "Authorization", "X-Requested-With", "Accept"]


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


settings = get_settings()
