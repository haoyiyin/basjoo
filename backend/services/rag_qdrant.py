"""RAG检索增强生成服务 - Qdrant 版本"""

from typing import List, Dict, Any, Optional
import logging

from .qdrant_store import QdrantVectorStore

logger = logging.getLogger(__name__)


class QdrantRAGService:
    """基于 Qdrant 的 RAG 检索增强生成服务"""

    def __init__(
        self,
        vector_store: QdrantVectorStore,
        default_model: str = "gpt-4.1-mini",
        default_temperature: float = 0.7,
        default_max_tokens: int = 1024,
    ):
        """
        初始化RAG服务

        Args:
            vector_store: Qdrant 向量存储实例
            default_model: 默认LLM模型
            default_temperature: 默认温度
            default_max_tokens: 默认最大token数
        """
        self.vector_store = vector_store
        self.default_model = default_model
        self.default_temperature = default_temperature
        self.default_max_tokens = default_max_tokens

    def retrieve(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = 0.5,  # 提高阈值以提升检索质量
        include_qa: bool = True,
        qa_items: List[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        从知识库检索相关内容

        Args:
            agent_id: Agent ID
            query: 查询文本
            top_k: 返回的最大结果数
            threshold: 相似度阈值
            include_qa: 是否包含Q&A匹配
            qa_items: Q&A列表（从数据库查询）

        Returns:
            检索结果列表，包含 {content, score, metadata, type}
        """
        results = []

        # 从 Qdrant 向量索引检索内容
        logger.info(f"RAG检索开始: agent_id={agent_id}, query='{query}', top_k={top_k}, threshold={threshold}")
        vector_results = self.vector_store.search(
            agent_id=agent_id,
            query=query,
            top_k=top_k * 2,  # 获取更多结果，因为要过滤
            threshold=threshold,
        )

        logger.info(f"Qdrant返回 {len(vector_results)} 个结果")

        # 根据source_type分类结果
        url_count = 0
        qa_count = 0
        for result in vector_results:
            source_type = result.get("metadata", {}).get("source_type", "url")
            if source_type == "qa":
                # 向量索引中的Q&A结果
                qa_count += 1
                results.append(
                    {
                        "type": "qa",
                        "content": result["content"],
                        "score": result["score"],
                        "metadata": {
                            "question": result.get("metadata", {}).get("question", ""),
                            "qa_id": result.get("metadata", {}).get("qa_id", ""),
                        },
                    }
                )
            else:
                # URL结果
                url_count += 1
                results.append(
                    {
                        "type": "url",
                        "content": result["content"],
                        "score": result["score"],
                        "metadata": result.get("metadata", {}),
                    }
                )

        logger.info(f"向量检索结果统计: URL={url_count}, QA={qa_count}")

        # 检索Q&A（简单的关键词匹配）
        if include_qa and qa_items:
            qa_results = self._search_qa(query, qa_items, top_k // 2)
            logger.info(f"关键词匹配QA返回 {len(qa_results)} 个结果")
            for qa in qa_results:
                results.append(
                    {
                        "type": "qa",
                        "content": qa["answer"],
                        "score": qa["score"],
                        "metadata": {
                            "question": qa["question"],
                            "qa_id": qa["id"],
                        },
                    }
                )

        # 按分数排序
        results.sort(key=lambda x: x["score"], reverse=True)

        # 返回top_k结果
        final_results = results[:top_k]
        logger.info(f"最终返回 {len(final_results)} 个结果（按分数排序后）")

        # 记录最终结果详情（前3个）
        for i, r in enumerate(final_results[:3], 1):
            logger.info(f"  结果{i}: type={r['type']}, score={r['score']:.3f}, "
                       f"content_preview={r['content'][:50]}...")

        return final_results

    async def retrieve_async(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = 0.5,
        include_qa: bool = True,
        qa_items: List[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Async retrieve using non-blocking embedding for concurrent request handling.

        Same logic as retrieve() but uses async embedding to avoid blocking the event loop.
        """
        results = []

        # 从 Qdrant 向量索引检索内容 (async)
        logger.info(f"RAG async retrieve: agent_id={agent_id}, query='{query}', top_k={top_k}")
        vector_results = await self.vector_store.search_async(
            agent_id=agent_id,
            query=query,
            top_k=top_k * 2,
            threshold=threshold,
        )

        logger.info(f"Qdrant async returned {len(vector_results)} results")

        # 根据source_type分类结果
        url_count = 0
        qa_count = 0
        for result in vector_results:
            source_type = result.get("metadata", {}).get("source_type", "url")
            if source_type == "qa":
                qa_count += 1
                results.append(
                    {
                        "type": "qa",
                        "content": result["content"],
                        "score": result["score"],
                        "metadata": {
                            "question": result.get("metadata", {}).get("question", ""),
                            "qa_id": result.get("metadata", {}).get("qa_id", ""),
                        },
                    }
                )
            else:
                url_count += 1
                results.append(
                    {
                        "type": "url",
                        "content": result["content"],
                        "score": result["score"],
                        "metadata": result.get("metadata", {}),
                    }
                )

        logger.info(f"Vector results: URL={url_count}, QA={qa_count}")

        # 检索Q&A（简单的关键词匹配）
        if include_qa and qa_items:
            qa_results = self._search_qa(query, qa_items, top_k // 2)
            logger.info(f"Keyword QA returned {len(qa_results)} results")
            for qa in qa_results:
                results.append(
                    {
                        "type": "qa",
                        "content": qa["answer"],
                        "score": qa["score"],
                        "metadata": {
                            "question": qa["question"],
                            "qa_id": qa["id"],
                        },
                    }
                )

        # 按分数排序
        results.sort(key=lambda x: x["score"], reverse=True)

        # 返回top_k结果
        final_results = results[:top_k]
        logger.info(f"Returning {len(final_results)} results")

        return final_results

    def _search_qa(
        self,
        query: str,
        qa_items: List[Dict[str, Any]],
        top_k: int = 3,
    ) -> List[Dict[str, Any]]:
        """
        搜索Q&A（简单关键词匹配）

        Args:
            query: 查询文本
            qa_items: Q&A列表
            top_k: 返回的最大结果数

        Returns:
            匹配的Q&A列表
        """
        from difflib import SequenceMatcher

        scored_qa = []

        query_lower = query.lower()

        for qa in qa_items:
            question = qa.get("question", "")
            question_lower = question.lower()

            # 计算相似度
            similarity = SequenceMatcher(None, query_lower, question_lower).ratio()

            # 检查关键词匹配
            query_words = set(query_lower.split())
            question_words = set(question_lower.split())

            overlap = len(query_words & question_words)
            overlap_score = overlap / max(len(query_words), 1)

            # 综合分数
            final_score = similarity * 0.7 + overlap_score * 0.3

            if final_score > 0.1:  # 降低最低阈值从0.2到0.1，提高召回率
                scored_qa.append(
                    {
                        **qa,
                        "score": final_score,
                    }
                )

        # 按分数排序并返回top_k
        scored_qa.sort(key=lambda x: x["score"], reverse=True)
        if scored_qa:
            logger.info(f"Top {top_k} QA matches found")
            for i, qa in enumerate(scored_qa[:top_k], 1):
                question = qa.get("question", "")
                score = qa.get("score", 0)
                logger.info(f"  {i}. {question}(score={score:.2f})")
        else:
            logger.info("No QA matches found above threshold.")
        return scored_qa[:top_k]

    def build_context(self, retrieval_results: List[Dict[str, Any]], locale: str = "zh-CN") -> str:
        """构建上下文字符串（统一使用英文模板）

        Args:
            retrieval_results: 检索结果列表
            locale: 语言代码（保留参数但不再使用，统一英文模板）

        Returns:
            上下文字符串
        """
        if not retrieval_results:
            return ""

        context_parts = []

        for i, result in enumerate(retrieval_results[:3], 1):
            if result["type"] == "url":
                title = result["metadata"].get("title", "Document")
                url = result["metadata"].get("url", "")
                content = result["content"][:500]  # 限制长度

                context_parts.append(f"[Source {i}] {title}\nURL: {url}\n{content}...")
            elif result["type"] == "qa":
                question = result["metadata"].get("question", "")
                answer = result["content"]

                context_parts.append(f"[Source {i}] Q: {question}\nA: {answer}")

        return "\n\n".join(context_parts)

    def extract_sources(
        self, retrieval_results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """提取来源信息"""
        sources = []

        for result in retrieval_results[:3]:
            if result["type"] == "url":
                sources.append(
                    {
                        "type": "url",
                        "title": result["metadata"].get("title", "文档"),
                        "url": result["metadata"].get("url", ""),
                        "snippet": result["content"][:200] + "...",
                    }
                )
            elif result["type"] == "qa":
                sources.append(
                    {
                        "type": "qa",
                        "question": result["metadata"].get("question", ""),
                        "id": result["metadata"].get("qa_id", ""),
                    }
                )

        return sources
