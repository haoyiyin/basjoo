"""Qdrant 向量数据库服务

替代 FAISS 的生产级向量存储方案，支持:
- 持久化存储
- REST/gRPC API
- 过滤查询
- 水平扩展
"""

from typing import List, Dict, Any, Optional
import logging
import httpx

from config import settings, DEFAULT_AGENT_SIMILARITY_THRESHOLD

logger = logging.getLogger(__name__)


class JinaEmbeddingClient:
    """Jina v3 embedding client with query caching and rate limiting"""

    _disabled_keys: set[str] = set()
    _embedding_cache: Dict[str, List[float]] = {}  # Simple in-memory cache
    _semaphore: Optional[Any] = None  # Rate limiting semaphore

    def __init__(self, api_key: str, model: str = "jina-embeddings-v3"):
        self.api_key = api_key
        self.model = model
        self.base_url = settings.jina_embedding_api_base
        self._disabled = api_key in self._disabled_keys

    def _get_semaphore(self):
        """Get or create the rate limiting semaphore (max 3 concurrent requests)."""
        import asyncio
        if JinaEmbeddingClient._semaphore is None:
            JinaEmbeddingClient._semaphore = asyncio.Semaphore(3)
        return JinaEmbeddingClient._semaphore

    def embed(self, texts: List[str]) -> List[List[float]]:
        """Synchronous embedding for index building (batch operations)."""
        if not self.api_key:
            raise ValueError("Jina API key is required")
        if not texts:
            return []
        if self._disabled:
            raise ValueError("Jina API key is invalid (401 Unauthorized). Please check your API key at https://jina.ai/api-dashboard/key-manager")

        try:
            response = httpx.post(
                self.base_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            embeddings = [item["embedding"] for item in payload.get("data", [])]
            if len(embeddings) != len(texts):
                raise ValueError("Jina embeddings response size mismatch")
            # 验证不是零向量
            for i, emb in enumerate(embeddings):
                if all(v == 0.0 for v in emb):
                    raise ValueError(f"Embedding {i} is a zero vector - API may have returned invalid data")
            return embeddings
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 401:
                self._disabled = True
                self._disabled_keys.add(self.api_key)
                raise ValueError("Jina API key is invalid (401 Unauthorized). Please check your API key at https://jina.ai/api-dashboard/key-manager")
            raise

    async def embed_async(self, texts: List[str]) -> List[List[float]]:
        """Async embedding for query search with caching and rate limiting."""
        if not self.api_key:
            raise ValueError("Jina API key is required")
        if not texts:
            return []
        if self._disabled:
            raise ValueError("Jina API key is invalid (401 Unauthorized). Please check your API key at https://jina.ai/api-dashboard/key-manager")

        # Check cache for single query (most common case for search)
        if len(texts) == 1:
            cache_key = texts[0]
            if cache_key in self._embedding_cache:
                logger.info(f"Using cached embedding for query: {cache_key[:50]}...")
                return [self._embedding_cache[cache_key]]

        # Use semaphore to limit concurrent API calls and avoid rate limiting
        async with self._get_semaphore():
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.post(
                        self.base_url,
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json={"model": self.model, "input": texts},
                    )
                    response.raise_for_status()
                    payload = response.json()
                    embeddings = [item["embedding"] for item in payload.get("data", [])]
                    if len(embeddings) != len(texts):
                        raise ValueError("Jina embeddings response size mismatch")
                    # 验证不是零向量
                    for i, emb in enumerate(embeddings):
                        if all(v == 0.0 for v in emb):
                            raise ValueError(f"Embedding {i} is a zero vector - API may have returned invalid data")

                    # Cache single query results
                    if len(texts) == 1:
                        self._embedding_cache[texts[0]] = embeddings[0]
                        if len(self._embedding_cache) > settings.embedding_cache_max_entries:
                            keys_to_remove = list(self._embedding_cache.keys())[:settings.embedding_cache_trim_count]
                            for key in keys_to_remove:
                                del self._embedding_cache[key]

                    return embeddings
            except httpx.HTTPStatusError as exc:
                if exc.response is not None and exc.response.status_code == 401:
                    self._disabled = True
                    self._disabled_keys.add(self.api_key)
                    raise ValueError("Jina API key is invalid (401 Unauthorized). Please check your API key at https://jina.ai/api-dashboard/key-manager")
                raise


class QdrantVectorStore:
    """基于 Qdrant 的向量存储"""

    def __init__(
        self,
        jina_api_key: str,
        embedding_model: str = "jina-embeddings-v3",
        collection_prefix: str = "basjoo",
    ):
        """
        初始化 Qdrant 向量存储

        Args:
            jina_api_key: Jina API Key
            embedding_model: 嵌入模型名称或路径
            collection_prefix: 集合名称前缀
        """
        from qdrant_client import QdrantClient
        from qdrant_client.http import models

        self.embedding_model = embedding_model
        self.collection_prefix = collection_prefix
        self.models = models

        # 初始化 Qdrant 客户端
        if settings.qdrant_path:
            logger.info(f"Connecting to local Qdrant at {settings.qdrant_path}")
            self.client = QdrantClient(path=settings.qdrant_path)
        else:
            logger.info(f"Connecting to Qdrant at {settings.qdrant_host}:{settings.qdrant_port}")
            self.client = QdrantClient(
                host=settings.qdrant_host,
                port=settings.qdrant_port,
                api_key=settings.qdrant_api_key,
                timeout=30,
                prefer_grpc=False,
            )

        self.embedding_client = JinaEmbeddingClient(api_key=jina_api_key, model=embedding_model)
        self.dimension = 1024

        if not jina_api_key:
            raise ValueError("Jina API key is required")

        logger.info(f"QdrantVectorStore initialized with dimension={self.dimension}")

    def _get_collection_name(self, agent_id: str) -> str:
        """获取 Agent 对应的集合名称"""
        safe_id = agent_id.replace("-", "_").replace(":", "_")
        return f"{self.collection_prefix}_{safe_id}"

    def _ensure_collection(self, agent_id: str) -> str:
        """确保集合存在，不存在则创建"""
        collection_name = self._get_collection_name(agent_id)

        try:
            collections = self.client.get_collections().collections
            exists = any(c.name == collection_name for c in collections)

            if not exists:
                logger.info(f"Creating collection: {collection_name}")
                self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config=self.models.VectorParams(
                        size=self.dimension,
                        distance=self.models.Distance.COSINE,
                    ),
                    optimizers_config=self.models.OptimizersConfigDiff(
                        indexing_threshold=0,  # 立即索引所有点，无需等待
                    ),
                )
                # 创建索引以支持过滤查询
                self.client.create_payload_index(
                    collection_name=collection_name,
                    field_name="source_type",
                    field_schema=self.models.PayloadSchemaType.KEYWORD,
                )
        except Exception as e:
            logger.error(f"Error ensuring collection {collection_name}: {e}")
            raise

        return collection_name

    def add_documents(
        self,
        agent_id: str,
        chunks: List[Dict[str, Any]],
    ) -> int:
        """
        添加文档到索引（支持增量更新）

        Args:
            agent_id: Agent ID
            chunks: 文档块列表，每个块包含 {content, metadata}

        Returns:
            添加的向量数
        """
        if not chunks:
            return 0

        collection_name = self._ensure_collection(agent_id)

        # 提取文本内容
        texts = [chunk["content"] for chunk in chunks]

        # 生成嵌入向量
        logger.info(f"Encoding {len(texts)} chunks...")
        embeddings = self.embedding_client.embed(texts)

        # 构建 Qdrant points
        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            # 生成确定性ID用于去重更新
            point_id = self._generate_point_id(chunk)
            payload = {
                "content": chunk["content"],
                "source_type": chunk.get("metadata", {}).get("source_type", "unknown"),
                **chunk.get("metadata", {}),
            }
            points.append(
                self.models.PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload=payload,
                )
            )

        # 批量插入（upsert会自动更新已存在的ID）
        self.client.upsert(
            collection_name=collection_name,
            points=points,
        )

        logger.info(f"Added {len(points)} vectors to collection {collection_name}")
        return len(points)

    def _generate_point_id(self, chunk: Dict[str, Any]) -> str:
        """生成确定性的point ID用于去重更新（必须是有效的UUID格式）"""
        import hashlib
        import uuid
        metadata = chunk.get("metadata", {})
        chunk_idx = chunk.get("chunk_index", 0)
        
        # 构建唯一的字符串用于生成UUID
        if "url_id" in metadata:
            unique_str = f"url_{metadata['url_id']}_{chunk_idx}"
        elif "qa_id" in metadata:
            unique_str = f"qa_{metadata['qa_id']}_{chunk_idx}"
        elif "source_url" in metadata:
            url_hash = hashlib.md5(metadata["source_url"].encode()).hexdigest()[:12]
            unique_str = f"url_{url_hash}_{chunk_idx}"
        else:
            # fallback: 使用内容hash
            content_hash = hashlib.md5(chunk.get("content", "").encode()).hexdigest()[:16]
            unique_str = f"hash_{content_hash}_{chunk_idx}"
        
        # 生成UUID5（基于命名空间的UUID，确保相同输入生成相同UUID）
        hash_obj = hashlib.md5(unique_str.encode())
        return str(uuid.UUID(bytes=hash_obj.digest()[:16]))

    def delete_by_source(self, agent_id: str, source_type: str, source_id: str) -> int:
        """
        删除指定来源的所有文档

        Args:
            agent_id: Agent ID
            source_type: 来源类型（url/qa）
            source_id: 来源ID

        Returns:
            删除的向量数
        """
        collection_name = self._get_collection_name(agent_id)

        try:
            # 检查集合是否存在
            collections = self.client.get_collections().collections
            if not any(c.name == collection_name for c in collections):
                return 0

            # 根据source_type构建过滤条件
            if source_type == "url":
                filter_condition = self.models.Filter(
                    must=[
                        self.models.FieldCondition(
                            key="url_id",
                            match=self.models.MatchValue(value=source_id),
                        )
                    ]
                )
            elif source_type == "qa":
                filter_condition = self.models.Filter(
                    must=[
                        self.models.FieldCondition(
                            key="qa_id",
                            match=self.models.MatchValue(value=source_id),
                        )
                    ]
                )
            else:
                logger.warning(f"Unknown source_type: {source_type}")
                return 0

            # 删除匹配的points
            result = self.client.delete(
                collection_name=collection_name,
                points_selector=self.models.FilterSelector(filter=filter_condition),
            )

            logger.info(f"Deleted points for {source_type}_{source_id} from collection {collection_name}")
            return 1  # Qdrant不返回删除数量，返回1表示操作成功

        except Exception as e:
            logger.error(f"Error deleting by source: {e}")
            return 0

    def delete_document(self, agent_id: str, point_id: str) -> bool:
        """
        删除单个文档

        Args:
            agent_id: Agent ID
            point_id: Point ID

        Returns:
            是否删除成功
        """
        collection_name = self._get_collection_name(agent_id)

        try:
            self.client.delete(
                collection_name=collection_name,
                points_selector=self.models.PointIdsList(points=[point_id]),
            )
            logger.info(f"Deleted point {point_id} from collection {collection_name}")
            return True
        except Exception as e:
            logger.error(f"Error deleting point {point_id}: {e}")
            return False

    def search(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = DEFAULT_AGENT_SIMILARITY_THRESHOLD,
        source_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        在索引中搜索相似文档

        Args:
            agent_id: Agent ID
            query: 查询文本
            top_k: 返回的最大结果数
            threshold: 相似度阈值（0-1）
            source_type: 可选的来源类型过滤（url/qa）

        Returns:
            匹配的文档列表，每个文档包含 {content, score, metadata}
        """
        collection_name = self._get_collection_name(agent_id)
        logger.info(f"Qdrant搜索: collection={collection_name}, query='{query[:50]}...', top_k={top_k}, threshold={threshold}, source_type={source_type}")

        # 检查集合是否存在
        try:
            collections = self.client.get_collections().collections
            if not any(c.name == collection_name for c in collections):
                logger.warning(f"Collection {collection_name} not found")
                return []
        except Exception as e:
            logger.error(f"Error checking collection: {e}")
            return []

        # 获取集合信息（调试用）
        try:
            info = self.client.get_collection(collection_name)
            logger.info(f"Collection {collection_name} has {info.points_count} points")
        except Exception:
            logger.warning(f"Failed to get collection info for {collection_name}")

        # 生成查询向量
        query_vector = self.embedding_client.embed([query])[0]

        # 构建过滤条件
        query_filter = None
        if source_type:
            query_filter = self.models.Filter(
                must=[
                    self.models.FieldCondition(
                        key="source_type",
                        match=self.models.MatchValue(value=source_type),
                    )
                ]
            )

        # 搜索
        try:
            try:
                results = self.client.search(
                    collection_name=collection_name,
                    query_vector=query_vector,
                    query_filter=query_filter,
                    limit=top_k * 2,  # 获取更多结果用于过滤
                    # score_threshold=threshold,  # 禁用阈值，使用后端过滤
                )
            except AttributeError:
                results = self.client.query_points(
                    collection_name=collection_name,
                    query=query_vector,
                    query_filter=query_filter,
                    limit=top_k * 2,
                    # score_threshold=threshold,
                )
                if hasattr(results, "points"):
                    results = results.points
            logger.info(f"Qdrant.search() 返回 {len(results)} 个原始结果")
            # 记录原始分数
            if results:
                scores = [r.score for r in results]
                logger.info(f"原始分数范围: min={min(scores):.4f}, max={max(scores):.4f}")
                # 使用阈值过滤结果
                results = [r for r in results if r.score >= threshold]
                logger.info(f"阈值过滤后: {len(results)} 个结果 (threshold={threshold})")
        except Exception as e:
            logger.error(f"Error searching in Qdrant: {e}")
            return []

        # 转换结果格式
        documents = []
        for result in results:
            payload = result.payload or {}
            doc = {
                "content": payload.get("content", ""),
                "score": result.score,
                "metadata": {
                    k: v for k, v in payload.items() if k != "content"
                },
            }
            documents.append(doc)

        # 记录分数范围
        if documents:
            scores = [d["score"] for d in documents]
            logger.info(f"Qdrant结果分数范围: min={min(scores):.3f}, max={max(scores):.3f}, avg={sum(scores)/len(scores):.3f}")
            # 记录每个结果的source_type
            source_types = [d["metadata"].get("source_type", "unknown") for d in documents]
            logger.info(f"Qdrant结果类型分布: {dict((x, source_types.count(x)) for x in set(source_types))}")

        logger.info(f"Found {len(documents)} results for query (agent={agent_id})")
        return documents

    async def search_async(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = DEFAULT_AGENT_SIMILARITY_THRESHOLD,
        source_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Async search using non-blocking embedding for concurrent request handling.

        Same logic as search() but uses async embedding to avoid blocking the event loop.
        """
        collection_name = self._get_collection_name(agent_id)
        logger.info(f"Qdrant async search: collection={collection_name}, query='{query[:50]}...', top_k={top_k}")

        # 检查集合是否存在
        try:
            collections = self.client.get_collections().collections
            if not any(c.name == collection_name for c in collections):
                logger.warning(f"Collection {collection_name} not found")
                return []
        except Exception as e:
            logger.error(f"Error checking collection: {e}")
            return []

        # 获取集合信息并检查是否有文档
        try:
            info = self.client.get_collection(collection_name)
            points_count = getattr(info, "points_count", 0) or 0
            logger.info(f"Collection {collection_name} has {points_count} points")
            if points_count == 0:
                logger.info(f"Skipping embedding for empty collection {collection_name}")
                return []
        except Exception:
            logger.warning(f"Failed to get collection info for {collection_name}")

        # 生成查询向量 (async to avoid blocking)
        query_vector = await self.embedding_client.embed_async([query])
        query_vector = query_vector[0]

        # 构建过滤条件
        query_filter = None
        if source_type:
            query_filter = self.models.Filter(
                must=[
                    self.models.FieldCondition(
                        key="source_type",
                        match=self.models.MatchValue(value=source_type),
                    )
                ]
            )

        # 搜索 (Qdrant client operations are synchronous but fast)
        try:
            try:
                results = self.client.search(
                    collection_name=collection_name,
                    query_vector=query_vector,
                    query_filter=query_filter,
                    limit=top_k * 2,
                )
            except AttributeError:
                results = self.client.query_points(
                    collection_name=collection_name,
                    query=query_vector,
                    query_filter=query_filter,
                    limit=top_k * 2,
                )
                if hasattr(results, "points"):
                    results = results.points
            logger.info(f"Qdrant.search_async() returned {len(results)} raw results")
            if results:
                scores = [r.score for r in results]
                logger.info(f"Score range: min={min(scores):.4f}, max={max(scores):.4f}")
                results = [r for r in results if r.score >= threshold]
                logger.info(f"After threshold filter: {len(results)} results")
        except Exception as e:
            logger.error(f"Error searching in Qdrant: {e}")
            return []

        # 转换结果格式
        documents = []
        for result in results:
            payload = result.payload or {}
            doc = {
                "content": payload.get("content", ""),
                "score": result.score,
                "metadata": {
                    k: v for k, v in payload.items() if k != "content"
                },
            }
            documents.append(doc)

        logger.info(f"Found {len(documents)} results for query (agent={agent_id})")
        return documents

    def delete_collection(self, agent_id: str) -> bool:
        """
        删除 Agent 的索引集合

        Args:
            agent_id: Agent ID

        Returns:
            是否删除成功
        """
        collection_name = self._get_collection_name(agent_id)

        try:
            self.client.delete_collection(collection_name=collection_name)
            logger.info(f"Deleted collection: {collection_name}")
            return True
        except Exception as e:
            logger.error(f"Error deleting collection {collection_name}: {e}")
            return False

    def get_collection_info(self, agent_id: str) -> Dict[str, Any]:
        """
        获取集合信息

        Args:
            agent_id: Agent ID

        Returns:
            集合信息字典
        """
        collection_name = self._get_collection_name(agent_id)

        try:
            info = self.client.get_collection(collection_name=collection_name)
            points_count = getattr(info, "points_count", 0) or 0
            indexed_vectors_count = getattr(info, "indexed_vectors_count", 0) or 0
            vectors_count = max(points_count, indexed_vectors_count)
            return {
                "name": collection_name,
                "vectors_count": vectors_count or 0,
                "points_count": points_count,
                "status": info.status.value if info.status else "unknown",
            }
        except Exception as e:
            logger.warning(f"Collection {collection_name} not found: {e}")
            return {
                "name": collection_name,
                "vectors_count": 0,
                "points_count": 0,
                "status": "not_found",
            }

    def clear_collection(self, agent_id: str) -> bool:
        """
        清空集合中的所有向量（保留集合结构）

        Args:
            agent_id: Agent ID

        Returns:
            是否清空成功
        """
        collection_name = self._get_collection_name(agent_id)

        try:
            # 删除并重建集合
            self.client.delete_collection(collection_name=collection_name)
            self._ensure_collection(agent_id)
            logger.info(f"Cleared collection: {collection_name}")
            return True
        except Exception as e:
            logger.error(f"Error clearing collection {collection_name}: {e}")
            return False


class TextChunker:
    """文本分块器"""

    def __init__(
        self,
        chunk_size: int = 300,
        chunk_overlap: int = 50,
        model_name: str = "sentence-transformers/multi-qa-MiniLM-L6-cos-v1",
    ):
        """
        初始化文本分块器

        Args:
            chunk_size: 每块的最大token数
            chunk_overlap: 块之间的重叠token数
            model_name: 用于估算token数的模型
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        # 简单估算: 1 token ≈ 4 characters
        self.chunk_chars = chunk_size * 4

    def chunk_text(
        self,
        text: str,
        metadata: Dict[str, Any] = None,
    ) -> List[Dict[str, Any]]:
        """
        将文本分块

        Args:
            text: 输入文本
            metadata: 文档元数据

        Returns:
            文档块列表
        """
        chunks = []

        # 按段落分割
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        current_chunk = ""
        chunk_index = 0

        for para in paragraphs:
            # 如果单个段落超过chunk_size，需要进一步分割
            if len(para) > self.chunk_chars:
                # 保存当前chunk
                if current_chunk:
                    chunks.append(
                        {
                            "content": current_chunk.strip(),
                            "metadata": metadata or {},
                            "chunk_index": chunk_index,
                        }
                    )
                    chunk_index += 1
                    current_chunk = ""

                # 分割长段落
                sentences = self._split_sentences(para)
                for sent in sentences:
                    if len(current_chunk) + len(sent) + 1 <= self.chunk_chars:
                        current_chunk += sent + " "
                    else:
                        if current_chunk:
                            chunks.append(
                                {
                                    "content": current_chunk.strip(),
                                    "metadata": metadata or {},
                                    "chunk_index": chunk_index,
                                }
                            )
                            chunk_index += 1
                        current_chunk = sent + " "
            else:
                # 检查是否需要新chunk
                if len(current_chunk) + len(para) + 2 > self.chunk_chars:
                    if current_chunk:
                        chunks.append(
                            {
                                "content": current_chunk.strip(),
                                "metadata": metadata or {},
                                "chunk_index": chunk_index,
                            }
                        )
                        chunk_index += 1
                        current_chunk = ""
                    current_chunk = para + "\n\n"
                else:
                    current_chunk += para + "\n\n"

        # 添加最后一个chunk
        if current_chunk.strip():
            chunks.append(
                {
                    "content": current_chunk.strip(),
                    "metadata": metadata or {},
                    "chunk_index": chunk_index,
                }
            )

        logger.info(f"Split text into {len(chunks)} chunks")
        return chunks

    def _split_sentences(self, text: str) -> List[str]:
        """简单的句子分割"""
        import re

        # 按句号、问号、感叹号分割
        sentences = re.split(r"[。！？.!?]+", text)
        return [s.strip() + "。" for s in sentences if s.strip()]
