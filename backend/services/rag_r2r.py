"""RAG service backed by R2R."""

import logging
from typing import Any, Optional

from .r2r_client import R2RClient

logger = logging.getLogger(__name__)


def _format_content(content: str, file_type: Optional[str] = None) -> str:
    """Detect tabular data and format as markdown code block for better LLM interpretation."""
    # Always wrap known tabular file types
    if file_type in ("xlsx", "csv", "tsv"):
        return f"```csv\n{content}\n```"

    lines = [l for l in content.split("\n") if l.strip()]
    if len(lines) < 2:
        return content

    # Check if all lines have consistent delimiter counts (CSV/TSV pattern)
    for sep in (",", "\t"):
        counts = [l.count(sep) for l in lines]
        if counts[0] > 0 and all(c == counts[0] for c in counts):
            lang = "csv" if sep == "," else "tsv"
            return f"```{lang}\n{content}\n```"

    return content


class R2RRAGService:
    """RAG retrieval service that delegates search to R2R."""

    def __init__(self, r2r_client: R2RClient):
        self.r2r = r2r_client

    async def retrieve_async(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = 0.01,
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
        """Build context string for LLM system prompt.

        Groups chunks from the same file together so the LLM can see
        header + data rows as a coherent table for structured formats.
        """
        if not retrieval_results:
            return ""

        # Group results by (type, key) where key is filename or URL
        from collections import OrderedDict
        grouped: OrderedDict[str, list[tuple[int, dict]]] = OrderedDict()
        for i, result in enumerate(retrieval_results, 1):
            source_type = result.get("type", "file")
            meta = result.get("metadata", {})
            if source_type == "url":
                key = f"url:{meta.get('url', '')}"
            elif source_type == "file":
                key = f"file:{meta.get('filename', meta.get('title', ''))}"
            else:
                key = f"other:{i}"
            grouped.setdefault(key, []).append((i, result))

        # Sort chunks within each group by chunk_order to preserve document structure
        for key in grouped:
            grouped[key].sort(key=lambda x: x[1].get("metadata", {}).get("chunk_order", 0))

        context_parts = []
        for key, items in grouped.items():
            indices = [str(i) for i, _ in items]
            first_result = items[0][1]
            source_type = first_result.get("type", "file")
            meta = first_result.get("metadata", {})
            file_type = meta.get("file_type")
            source_label = f"Source{'s' if len(indices) > 1 else ''} {', '.join(indices)}"

            # Combine content from all chunks of the same file
            combined_content = "\n".join(r["content"][:800] for _, r in items)

            if source_type == "url":
                title = meta.get("title", "Document")
                url = meta.get("url", "")
                context_parts.append(f"[{source_label}] {title}\nURL: {url}\n{combined_content}")
            elif source_type == "file":
                formatted = _format_content(combined_content, file_type)
                context_parts.append(f"[{source_label}]\n{formatted}")
            else:
                context_parts.append(f"[{source_label}] {combined_content}")

        context_parts.append(
            "Citation rules:\n"
            "- If you reference a URL source, cite it inline with markdown using a placeholder like [keyword](#source-1).\n"
            "- Do NOT cite file sources. When using file content, answer directly without mentioning the source.\n"
            "- Only use source numbers that appear above.\n"
            "- Do not invent or write raw external URLs yourself."
        )

        return "\n\n".join(context_parts)

    def extract_sources(self, retrieval_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Extract source information for API response, deduplicated by file/URL."""
        seen = set()
        sources = []

        for result in retrieval_results:
            source_type = result.get("type", "file")
            meta = result.get("metadata", {})

            if source_type == "url":
                dedup_key = f"url:{meta.get('url', '')}"
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
                sources.append({
                    "type": "url",
                    "title": meta.get("title", "Document"),
                    "url": meta.get("url", ""),
                    "snippet": result["content"][:300] + "...",
                })

        return sources
