"""RAG service backed by R2R."""

import logging
from typing import Any

from .r2r_client import R2RClient

logger = logging.getLogger(__name__)


class R2RRAGService:
    """RAG retrieval service that delegates search to R2R."""

    def __init__(self, r2r_client: R2RClient):
        self.r2r = r2r_client

    async def retrieve_async(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = 0.3,
        **kwargs,
    ) -> list[dict[str, Any]]:
        """Retrieve relevant documents from R2R."""
        logger.info(f"R2R retrieve: agent_id={agent_id}, query='{query}', top_k={top_k}")
        try:
            results = await self.r2r.search(
                agent_id=agent_id,
                query=query,
                top_k=top_k,
                threshold=threshold,
            )
            logger.info(f"R2R returned {len(results)} results")

            # Classify results by metadata source_type
            classified = []
            for r in results:
                meta = r.get("metadata", {})
                source_type = meta.get("source_type", "file")
                classified.append({
                    "type": source_type,
                    "content": r["content"],
                    "score": r["score"],
                    "metadata": meta,
                })

            return classified
        except Exception as e:
            logger.warning(f"R2R search failed: {e}")
            return []

    def build_context(self, retrieval_results: list[dict[str, Any]], locale: str = "zh-CN") -> str:
        """Build context string for LLM system prompt."""
        if not retrieval_results:
            return ""

        context_parts = []

        for i, result in enumerate(retrieval_results[:3], 1):
            source_type = result.get("type", "file")
            meta = result.get("metadata", {})

            if source_type == "url":
                title = meta.get("title", "Document")
                url = meta.get("url", "")
                content = result["content"][:500]
                context_parts.append(f"[Source {i}] {title}\nURL: {url}\n{content}...")
            elif source_type == "file":
                filename = meta.get("filename", meta.get("title", "File"))
                content = result["content"][:500]
                context_parts.append(f"[Source {i}] {filename}\n{content}...")
            else:
                content = result["content"][:500]
                context_parts.append(f"[Source {i}] {content}...")

        context_parts.append(
            "Citation rules:\n"
            "- If you reference a source, cite it inline with markdown using a placeholder like [keyword](#source-1).\n"
            "- Only use source numbers that appear above.\n"
            "- Do not invent or write raw external URLs yourself."
        )

        return "\n\n".join(context_parts)

    def extract_sources(self, retrieval_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Extract source information for API response."""
        sources = []

        for result in retrieval_results[:3]:
            source_type = result.get("type", "file")
            meta = result.get("metadata", {})

            if source_type == "url":
                sources.append({
                    "type": "url",
                    "title": meta.get("title", "Document"),
                    "url": meta.get("url", ""),
                    "snippet": result["content"][:200] + "...",
                })
            elif source_type == "file":
                sources.append({
                    "type": "file",
                    "filename": meta.get("filename", meta.get("title", "File")),
                    "snippet": result["content"][:200] + "...",
                })

        return sources
