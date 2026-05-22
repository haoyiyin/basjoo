"""R2R HTTP client for document ingestion and retrieval."""

import logging
import httpx
from typing import Any, Optional

from config import settings

logger = logging.getLogger(__name__)

# Cache: agent_id -> r2r_collection_id
_collection_cache: dict[str, str] = {}


class R2RClient:
    """Thin async HTTP wrapper around R2R REST API (v3)."""

    def __init__(self, base_url: str | None = None, timeout: float = 60.0):
        self.base_url = (base_url or settings.r2r_api_url).rstrip("/")
        self.timeout = timeout

    # ── Collections ──────────────────────────────────────────────

    async def ensure_collection(self, agent_id: str) -> str:
        """Get or create an R2R collection for the given agent. Returns collection ID."""
        if agent_id in _collection_cache:
            return _collection_cache[agent_id]

        collection_name = f"basjoo_{agent_id.replace('-', '_').replace(':', '_')}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # List existing collections
            resp = await client.get(f"{self.base_url}/v3/collections")
            resp.raise_for_status()
            data = resp.json()
            collections = data.get("results", data.get("data", []))
            if isinstance(collections, dict):
                collections = collections.get("items", [])

            for col in collections:
                if col.get("name") == collection_name:
                    col_id = col["id"]
                    _collection_cache[agent_id] = col_id
                    return col_id

            # Create new collection
            resp = await client.post(
                f"{self.base_url}/v3/collections",
                json={"name": collection_name, "description": f"Knowledge base for agent {agent_id}"},
            )
            resp.raise_for_status()
            result = resp.json().get("results", resp.json().get("data", resp.json()))
            col_id = result["id"]
            _collection_cache[agent_id] = col_id
            logger.info(f"Created R2R collection '{collection_name}' (id={col_id})")
            return col_id

    async def delete_collection(self, agent_id: str) -> bool:
        """Delete the R2R collection for the given agent."""
        collection_id = await self.ensure_collection(agent_id)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(f"{self.base_url}/v3/collections/{collection_id}")
            if resp.status_code in (200, 204):
                _collection_cache.pop(agent_id, None)
                return True
            logger.warning(f"Failed to delete R2R collection {collection_id}: {resp.status_code}")
            return False

    # ── Document Ingestion ───────────────────────────────────────

    async def ingest_file(
        self,
        agent_id: str,
        file_content: bytes,
        filename: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Upload and ingest a file into R2R. Returns document info."""
        collection_id = await self.ensure_collection(agent_id)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            files = {"file": (filename, file_content, "application/octet-stream")}
            data: dict[str, Any] = {
                "collection_ids": f'["{collection_id}"]',
            }
            if metadata:
                import json
                data["metadata"] = json.dumps(metadata)

            resp = await client.post(
                f"{self.base_url}/v3/documents",
                files=files,
                data=data,
            )
            resp.raise_for_status()
            result = resp.json()
            return result.get("results", result.get("data", result))

    async def ingest_text(
        self,
        agent_id: str,
        text: str,
        title: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Ingest raw text content (e.g., from URL scraping)."""
        collection_id = await self.ensure_collection(agent_id)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            payload: dict[str, Any] = {
                "raw_text": text,
                "collection_ids": [collection_id],
                "metadata": metadata or {},
            }
            resp = await client.post(
                f"{self.base_url}/v3/documents",
                json=payload,
            )
            resp.raise_for_status()
            result = resp.json()
            return result.get("results", result.get("data", result))

    async def delete_document(self, document_id: str) -> bool:
        """Delete a document from R2R."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(f"{self.base_url}/v3/documents/{document_id}")
            return resp.status_code in (200, 204)

    async def list_documents(self, agent_id: str) -> list[dict[str, Any]]:
        """List all documents in the agent's collection."""
        collection_id = await self.ensure_collection(agent_id)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/v3/documents",
                params={"collection_id": collection_id},
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", data.get("data", []))
            if isinstance(results, dict):
                results = results.get("items", [])
            return results

    # ── Search / Retrieval ───────────────────────────────────────

    async def search(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float = 0.3,
    ) -> list[dict[str, Any]]:
        """Search the agent's collection. Returns results compatible with current format."""
        collection_id = await self.ensure_collection(agent_id)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            payload = {
                "query": query,
                "search_settings": {
                    "filters": {"collection_ids": {"$eq": collection_id}},
                    "limit": top_k,
                    "hybrid_settings": {
                        "semantic_weight": 0.7,
                        "full_text_weight": 0.3,
                    },
                },
            }
            resp = await client.post(
                f"{self.base_url}/v3/retrieval/search",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", data.get("data", data))
            if isinstance(results, dict):
                results = results.get("chunk_search_results", [])

            # Normalize to [{content, score, metadata}]
            normalized = []
            for r in results:
                score = r.get("score", 0.0)
                if score < threshold:
                    continue
                normalized.append({
                    "content": r.get("text", r.get("content", "")),
                    "score": score,
                    "metadata": r.get("metadata", {}),
                })

            return normalized

    # ── Health ───────────────────────────────────────────────────

    async def health(self) -> bool:
        """Check if R2R is healthy."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/v3/health")
                return resp.status_code == 200
        except Exception:
            return False
