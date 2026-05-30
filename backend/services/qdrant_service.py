"""Qdrant collection management for per-KB isolation. 幂等 + Cosine + dim lookup."""

import logging

from config import settings
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import CollectionInfo, Distance, VectorParams

logger = logging.getLogger(__name__)


def get_embedding_dimension(model: str) -> int:
    """模型到向量维度映射（BGE-M3=1024 等）。可扩展。"""
    m = model.lower()
    if "bge-m3" in m or "bge_m3" in m or "baai/bge-m3" in m:
        return 1024
    if "jina" in m or "jina-embeddings" in m:
        return 1024
    if "text-embedding-3-large" in m:
        return 3072
    if "text-embedding-3-small" in m or "ada" in m:
        return 1536
    return 1024  # safe default


class QdrantKbService:
    def __init__(self):
        self.client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=int(settings.qdrant_timeout),
        )

    async def ensure_collection(self, kb_id: str, embedding_model: str) -> str:
        """幂等创建 collection。已存在则返回名称。"""
        short = kb_id.replace("-", "")[:12] if "-" in kb_id else kb_id[:12]
        collection_name = f"kb_{short}"
        dim = get_embedding_dimension(embedding_model)

        try:
            info: CollectionInfo | None = await self.client.get_collection(collection_name)
            if info:
                logger.info(f"Qdrant collection '{collection_name}' already exists (dim={dim})")
                return collection_name
        except Exception:
            pass  # not found → create

        await self.client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
        logger.info(f"Created Qdrant collection '{collection_name}' (dim={dim}, Cosine)")
        return collection_name
