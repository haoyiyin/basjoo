"""Generate r2r.toml and r2r.env from agent embedding settings."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Default embedding dimension for all providers
DEFAULT_DIMENSION = 1024

PROVIDER_MODEL_MAP = {
    "jina": {
        "provider": "litellm",
        "base_model": "jina_ai/jina-embeddings-v3",
        "base_dimension": DEFAULT_DIMENSION,
    },
    "siliconflow": {
        "provider": "litellm",
        "base_model": "BAAI/bge-m3",
        "base_dimension": DEFAULT_DIMENSION,
    },
}


def _r2r_config_paths():
    """Resolve r2r.toml and r2r.env paths from settings or repository layout fallback."""
    from config import settings

    config_dir = getattr(settings, "r2r_config_dir", "").strip()
    if config_dir:
        base = Path(config_dir)
    else:
        base = Path(__file__).resolve().parents[2] / "r2r-config"
    return base / "user_configs" / "r2r.toml", base / "r2r.env"


def generate_r2r_toml_content(
    embedding_provider: str,
    embedding_model: str,
    embedding_batch_size: int = 16,
    embedding_api_base: str | None = None,
) -> str:
    """Generate r2r.toml content from agent embedding settings."""
    if embedding_provider == "custom":
        model = embedding_model or "jina_ai/jina-embeddings-v3"
        dimension = DEFAULT_DIMENSION
        provider = "litellm"
    else:
        cfg = PROVIDER_MODEL_MAP.get(embedding_provider, PROVIDER_MODEL_MAP["jina"])
        # Normalize bare jina model names to LiteLLM format
        raw_model = embedding_model or cfg["base_model"]
        if embedding_provider == "jina" and "jina-embeddings-v3" in raw_model and "/" not in raw_model:
            model = "jina_ai/jina-embeddings-v3"
        else:
            model = raw_model
        dimension = cfg["base_dimension"]
        provider = cfg["provider"]

    batch_size = max(1, min(64, embedding_batch_size or 16))

    # Build toml string (avoids adding toml dependency)
    lines = [
        "[embedding]",
        f'provider = "{provider}"',
        f'base_model = "{model}"',
        f"base_dimension = {dimension}",
        f"batch_size = {batch_size}",
        "concurrent_request_limit = 256",
    ]
    if embedding_provider == "custom" and embedding_api_base:
        # Sanitize: strip and escape characters that break TOML double-quoted strings
        safe_base = str(embedding_api_base).strip().replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'api_base = "{safe_base}"')
    lines.append("")

    lines += [
        "[completion_embedding]",
        f'provider = "{provider}"',
        f'base_model = "{model}"',
        f"base_dimension = {dimension}",
        f"batch_size = {batch_size}",
    ]
    if embedding_provider == "custom" and embedding_api_base:
        safe_base = str(embedding_api_base).strip().replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'api_base = "{safe_base}"')
    lines.append("")

    lines += [
        "[ingestion]",
        'provider = "r2r"',
        'chunking_strategy = "recursive"',
        "chunk_size = 1024",
        "chunk_overlap = 512",
        "automatic_extraction = false",
        "skip_document_summary = true",
        "",
        "[completion]",
        'provider = "r2r"',
        "",
        "[database]",
        'provider = "postgres"',
        "",
        "[file]",
        'provider = "postgres"',
        "",
        "[auth]",
        "require_authentication = false",
        "",
        "[orchestration]",
        'provider = "simple"',
        "",
    ]
    return "\n".join(lines)


def write_r2r_config(
    embedding_provider: str,
    embedding_model: str,
    embedding_batch_size: int = 16,
    embedding_api_base: str | None = None,
    jina_api_key: str | None = None,
    siliconflow_api_key: str | None = None,
) -> Path:
    """Write r2r.toml and update r2r.env from agent embedding settings."""
    toml_path, env_path = _r2r_config_paths()

    toml_content = generate_r2r_toml_content(
        embedding_provider, embedding_model, embedding_batch_size, embedding_api_base
    )
    toml_path.parent.mkdir(parents=True, exist_ok=True)
    toml_path.write_text(toml_content, encoding="utf-8")
    logger.info(f"Wrote r2r.toml to {toml_path} (provider={embedding_provider})")

    _update_r2r_env(embedding_provider, jina_api_key, siliconflow_api_key, env_path)

    return toml_path


def _update_r2r_env(
    embedding_provider: str,
    jina_api_key: str | None,
    siliconflow_api_key: str | None,
    env_path: Path,
) -> None:
    """Update r2r.env to include the embedding API key."""
    env_content = ""
    if env_path.exists():
        env_content = env_path.read_text(encoding="utf-8")

    # Remove existing API key lines
    lines = [line for line in env_content.splitlines()
             if not line.startswith("JINA_API_KEY=")
             and not line.startswith("JINA_AI_API_KEY=")
             and not line.startswith("SILICONFLOW_API_KEY=")]

    # Add the correct key(s)
    if embedding_provider == "jina" and jina_api_key:
        lines.append(f"JINA_API_KEY={jina_api_key}")
        lines.append(f"JINA_AI_API_KEY={jina_api_key}")
    elif embedding_provider == "siliconflow" and siliconflow_api_key:
        lines.append(f"SILICONFLOW_API_KEY={siliconflow_api_key}")
    elif embedding_provider == "custom" and siliconflow_api_key:
        lines.append(f"SILICONFLOW_API_KEY={siliconflow_api_key}")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.info(f"Updated r2r.env with {embedding_provider} API key")
