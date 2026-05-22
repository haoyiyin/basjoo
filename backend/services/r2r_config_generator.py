"""Generate r2r.toml and r2r.env from agent embedding settings."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

R2R_CONFIG_DIR = Path(__file__).resolve().parents[2] / "r2r-config"
R2R_TOML_PATH = R2R_CONFIG_DIR / "user_configs" / "r2r.toml"
R2R_ENV_PATH = R2R_CONFIG_DIR / "r2r.env"

# Default embedding dimension for all providers
DEFAULT_DIMENSION = 1024

PROVIDER_MODEL_MAP = {
    "jina": {
        "provider": "litellm",
        "base_model": "jina/jina-embeddings-v3",
        "base_dimension": DEFAULT_DIMENSION,
    },
    "siliconflow": {
        "provider": "litellm",
        "base_model": "BAAI/bge-m3",
        "base_dimension": DEFAULT_DIMENSION,
    },
}


def generate_r2r_toml_content(
    embedding_provider: str,
    embedding_model: str,
    embedding_batch_size: int = 16,
    embedding_api_base: str | None = None,
) -> str:
    """Generate r2r.toml content from agent embedding settings."""
    if embedding_provider == "custom":
        model = embedding_model or "jina/jina-embeddings-v3"
        dimension = DEFAULT_DIMENSION
        provider = "litellm"
    else:
        cfg = PROVIDER_MODEL_MAP.get(embedding_provider, PROVIDER_MODEL_MAP["jina"])
        model = embedding_model or cfg["base_model"]
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
        "",
        "[completion_embedding]",
        f'provider = "{provider}"',
        f'base_model = "{model}"',
        f"base_dimension = {dimension}",
        f"batch_size = {batch_size}",
        "",
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
    # Generate and write toml
    toml_content = generate_r2r_toml_content(
        embedding_provider, embedding_model, embedding_batch_size, embedding_api_base
    )
    R2R_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    R2R_TOML_PATH.parent.mkdir(parents=True, exist_ok=True)
    R2R_TOML_PATH.write_text(toml_content, encoding="utf-8")
    logger.info(f"Wrote r2r.toml to {R2R_TOML_PATH} (provider={embedding_provider})")

    # Update r2r.env with the appropriate API key
    _update_r2r_env(embedding_provider, jina_api_key, siliconflow_api_key)

    return R2R_TOML_PATH


def _update_r2r_env(
    embedding_provider: str,
    jina_api_key: str | None,
    siliconflow_api_key: str | None,
) -> None:
    """Update r2r.env to include the embedding API key."""
    env_content = ""
    if R2R_ENV_PATH.exists():
        env_content = R2R_ENV_PATH.read_text(encoding="utf-8")

    # Remove existing API key lines
    lines = [line for line in env_content.splitlines()
             if not line.startswith("JINA_API_KEY=")
             and not line.startswith("SILICONFLOW_API_KEY=")]

    # Add the correct key
    if embedding_provider == "jina" and jina_api_key:
        lines.append(f"JINA_API_KEY={jina_api_key}")
    elif embedding_provider == "siliconflow" and siliconflow_api_key:
        lines.append(f"SILICONFLOW_API_KEY={siliconflow_api_key}")
    elif embedding_provider == "custom" and siliconflow_api_key:
        lines.append(f"SILICONFLOW_API_KEY={siliconflow_api_key}")

    R2R_ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.info(f"Updated r2r.env with {embedding_provider} API key")
