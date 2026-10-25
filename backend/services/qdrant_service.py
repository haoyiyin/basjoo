"""Qdrant collection management for per-KB isolation. 幂等 + Cosine + 维度守卫。"""

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
    """模型到向量维度映射。仅用于历史数据的迁移回填。

    Live code paths pass the MEASURED width to :meth:`QdrantKbService.ensure_collection`
    instead of deriving it from the model name.
    """
    m = (model or "").lower()
    if "jina-embeddings-v2-base-en" in m:
        return 768
    if "text-embedding-3-large" in m:
        return 3072
    if "text-embedding-3-small" in m or "ada" in m:
        return 1536
    if "bge-m3" in m or "bge_m3" in m:
        return 1024
    # Self-hosted TEI granite-embedding-97m (384 dims) — migration mapping only,
    # live paths still persist the MEASURED width.
    if "granite-embedding-97m" in m:
        return 384
    if "jina" in m:
        return 1024
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

    async def ensure_collection(self, kb_id: str, dimension: int) -> str:
        """幂等创建 collection，dimension 是实测向量宽度。

        - 不存在 → 按 ``dimension`` 创建。
        - 已存在且维度一致 → 幂等返回。
        - 已存在但维度不同 → 抛 ``RuntimeError``（调用方必须先 reset）。
        """
        collection_name = get_kb_collection_name(kb_id)
        dimension = int(dimension)

        existing_size = await self._existing_vector_size(collection_name)
        if existing_size is not None:
            if existing_size != dimension:
                raise RuntimeError(
                    f"collection {collection_name} has dimension {existing_size}, "
                    f"expected {dimension}; use reset"
                )
            logger.info(
                f"Qdrant collection '{collection_name}' already exists (dim={dimension})"
            )
            return collection_name

        await self.client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=dimension, distance=Distance.COSINE),
        )
        logger.info(
            f"Created Qdrant collection '{collection_name}' (dim={dimension}, Cosine)"
        )
        return collection_name

    async def _existing_vector_size(self, collection_name: str) -> int | None:
        """Return the collection's vector width, or None when it does not exist."""
        try:
            info: CollectionInfo | None = await self.client.get_collection(
                collection_name
            )
        except Exception:
            return None  # not found → caller creates it

        if not info:
            return None

        vectors_config = getattr(getattr(info, "config", None), "params", None)
        vectors_config = getattr(vectors_config, "vectors", None)
        size = getattr(vectors_config, "size", None)
        if size is None:
            return None
        return int(size)

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
            must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]
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

    async def search_kb(
        self,
        kb_id: str,
        query_vector: list[float],
        top_k: int = 5,
    ) -> list[dict]:
        """Search one KB's collection. Isolation is physical (one collection per KB).

        Returns list of {id, score, payload}. Vector data is not returned.
        """
        collection_name = get_kb_collection_name(kb_id)
        qfilter = Filter(
            must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
        )
        try:
            response = await self.client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=qfilter,
                limit=top_k,
                with_payload=True,
                with_vectors=False,
            )
            return [
                {"id": h.id, "score": h.score, "payload": h.payload or {}}
                for h in response.points
            ]
        except Exception as e:
            logger.warning(f"Qdrant search failed for kb={kb_id}: {e}")
            return []
