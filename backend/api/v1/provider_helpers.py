"""Shared provider-aware helpers for agent vector store and fetcher resolution."""

from models import Agent
from services import QdrantVectorStore
from core.encryption import decrypt_api_key


def resolve_agent_embedding_provider(agent: Agent) -> str:
    """Resolve the embedding provider for the agent, with backward-compatible fallback."""
    provider = getattr(agent, "embedding_provider", None)
    if provider in {"jina", "siliconflow", "custom"}:
        return provider
    return "siliconflow" if agent.provider_type == "siliconflow" else "jina"


def get_agent_embedding_config(agent: Agent) -> dict:
    """Resolve provider-neutral embedding config for the agent."""
    agent_api_key = decrypt_api_key(agent.api_key)
    agent_jina_api_key = decrypt_api_key(agent.jina_api_key)
    embedding_provider = resolve_agent_embedding_provider(agent)
    embedding_batch_size = getattr(agent, "embedding_batch_size", 4) or 4

    if embedding_provider in ("siliconflow", "custom"):
        embedding_model = agent.embedding_model
        if not embedding_model or embedding_model == "jina-embeddings-v3":
            embedding_model = "BAAI/bge-m3" if embedding_provider == "siliconflow" else "text-embedding-v4"

        siliconflow_key = decrypt_api_key(getattr(agent, "siliconflow_api_key", "") or "")
        legacy_siliconflow_key = agent_api_key if agent.provider_type == "siliconflow" else ""

        embedding_api_base = (
            agent.embedding_api_base
            if embedding_provider == "custom" and agent.embedding_api_base
            else "https://api.siliconflow.cn/v1"
        )

        return {
            "embedding_provider": "siliconflow",
            "embedding_api_key": siliconflow_key or legacy_siliconflow_key,
            "embedding_api_base": embedding_api_base,
            "embedding_model": embedding_model,
            "embedding_dimension": 1024,
            "embedding_batch_size": embedding_batch_size,
            "fetcher_provider": "trafilatura",
        }

    return {
        "embedding_provider": "jina",
        "embedding_api_key": agent_jina_api_key,
        "embedding_api_base": None,
        "embedding_model": agent.embedding_model or "jina-embeddings-v3",
        "embedding_dimension": 1024,
        "embedding_batch_size": embedding_batch_size,
        "fetcher_provider": "jina_reader",
    }


def get_agent_vector_store(agent: Agent) -> QdrantVectorStore:
    """Create a QdrantVectorStore configured for the agent's embedding provider."""
    embedding_config = get_agent_embedding_config(agent)
    api_key = embedding_config["embedding_api_key"]
    if not api_key:
        raise ValueError(f"{embedding_config['embedding_provider'].title()} API key is required")

    return QdrantVectorStore(
        embedding_provider=embedding_config["embedding_provider"],
        embedding_api_key=api_key,
        embedding_api_base=embedding_config["embedding_api_base"],
        embedding_model=embedding_config["embedding_model"],
        embedding_dimension=embedding_config["embedding_dimension"],
        embedding_batch_size=embedding_config["embedding_batch_size"],
    )


def get_agent_fetcher_provider(agent: Agent) -> str:
    """Return the URL fetcher provider for the agent."""
    return "trafilatura" if resolve_agent_embedding_provider(agent) in {"siliconflow", "custom"} else "jina_reader"
