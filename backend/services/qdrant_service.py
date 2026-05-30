"""Qdrant collection management for per-KB isolation. 幂等 + Cosine + dim lookup."""

import logging
import uuid

from config import settings
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    CollectionInfo,
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

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


def get_kb_collection_name(kb_id: str) -> str:
    """生成知识库对应的 Qdrant collection 名称（kb_ + 前12位无连字符ID）。"""
    short = kb_id.replace("-", "")[:12] if "-" in kb_id else kb_id[:12]
    return f"kb_{short}"


class QdrantKbService:
    def __init__(self):
        self.client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=int(settings.qdrant_timeout),
        )

    async def ensure_collection(self, kb_id: str, embedding_model: str) -> str:
        """幂等创建 collection。已存在则返回名称。"""
        collection_name = get_kb_collection_name(kb_id)
        dim = get_embedding_dimension(embedding_model)

        try:
            info: CollectionInfo | None = await self.client.get_collection(
                collection_name
            )
            if info:
                logger.info(
                    f"Qdrant collection '{collection_name}' already exists (dim={dim})"
                )
                return collection_name
        except Exception:
            pass  # not found → create

        await self.client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
        logger.info(
            f"Created Qdrant collection '{collection_name}' (dim={dim}, Cosine)"
        )
        return collection_name

    async def batch_upsert_points(
        self, kb_id: str, points: list[dict], batch_size: int = 100
    ) -> int:
        """Batch upsert points (max 100 per call). Returns count upserted."""
        collection_name = get_kb_collection_name(kb_id)
        total = 0
        for i in range(0, len(points), batch_size):
            batch = points[i : i + batch_size]
            qdrant_points = [
                PointStruct(
                    id=p.get("id") or str(uuid.uuid4()),
                    vector=p["vector"],
                    payload=p["payload"],
                )
                for p in batch
            ]
            await self.client.upsert(
                collection_name=collection_name, points=qdrant_points
            )
            total += len(batch)
        return total

    async def delete_points_by_doc_id(self, kb_id: str, doc_id: str) -> int:
        """Delete all points for a doc_id using filter. Returns deleted count (best-effort)."""
        collection_name = get_kb_collection_name(kb_id)
        flt = Filter(
            must=[
                FieldCondition(key="doc_id", match=MatchValue(value=doc_id))
            ]
        )
        try:
            await self.client.delete(
                collection_name=collection_name,
                points_selector=flt,
            )
            return 1  # success indicator
        except Exception as e:
            logger.warning(f"Qdrant delete failed for doc {doc_id}: {e}")
            return 0

    async def delete_collection(self, kb_id: str) -> bool:
        """幂等 delete collection (for KB cascade delete)."""
        collection_name = get_kb_collection_name(kb_id)
        try:
            await self.client.delete_collection(collection_name)
            return True
        except Exception:
            return False
