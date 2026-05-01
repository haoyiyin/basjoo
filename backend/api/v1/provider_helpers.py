"""Shared provider-aware helpers for agent vector store and fetcher resolution."""

from models import Agent
from services import QdrantVectorStore
from core.encryption import decrypt_api_key


def get_agent_embedding_config(agent: Agent) -> dict:
    """Resolve provider-neutral embedding config for the agent."""
    agent_api_key = decrypt_api_key(agent.api_key)
    agent_jina_api_key = decrypt_api_key(agent.jina_api_key)

    if agent.provider_type == "siliconflow":
        embedding_model = agent.embedding_model
        if not embedding_model or embedding_model == "jina-embeddings-v3":
            embedding_model = "BAAI/bge-m3"

        return {
            "embedding_provider": "siliconflow",
            "embedding_api_key": agent_api_key,
            "embedding_api_base": agent.api_base or "https://api.siliconflow.cn/v1",
            "embedding_model": embedding_model,
            "embedding_dimension": 1024,
            "fetcher_provider": "trafilatura",
        }

    return {
        "embedding_provider": "jina",
        "embedding_api_key": agent_jina_api_key,
        "embedding_api_base": None,
        "embedding_model": agent.embedding_model or "jina-embeddings-v3",
        "embedding_dimension": 1024,
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
    )


def get_agent_fetcher_provider(agent: Agent) -> str:
    """Return the URL fetcher provider for the agent."""
    return "trafilatura" if agent.provider_type == "siliconflow" else "jina_reader"
