"""R2R HTTP client for document ingestion and retrieval."""

import logging
import re
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
                    logger.info(f"Found existing R2R collection '{collection_name}' (id={col_id})")
                    return col_id

            # Create new collection
            resp = await client.post(
                f"{self.base_url}/v3/collections",
                json={"name": collection_name, "description": f"Knowledge base for agent {agent_id}"},
            )
            if resp.status_code == 409:
                # Collection already exists (created by another process) — re-fetch
                logger.info(f"Collection '{collection_name}' already exists, re-fetching list")
                _collection_cache.pop(agent_id, None)
                resp2 = await client.get(f"{self.base_url}/v3/collections")
                resp2.raise_for_status()
                data2 = resp2.json()
                collections2 = data2.get("results", data2.get("data", []))
                if isinstance(collections2, dict):
                    collections2 = collections2.get("items", [])
                for col in collections2:
                    if col.get("name") == collection_name:
                        col_id = col["id"]
                        _collection_cache[agent_id] = col_id
                        return col_id
            resp.raise_for_status()
            result = resp.json().get("results", resp.json().get("data", resp.json()))
            col_id = result["id"]
            _collection_cache[agent_id] = col_id
            logger.info(f"Created R2R collection '{collection_name}' (id={col_id})")
            return col_id

    async def _collection_id(self, agent_id: str) -> str | None:
        """Look up an existing R2R collection ID without creating one. Returns None if not found."""
        collection_name = f"basjoo_{agent_id.replace('-', '_').replace(':', '_')}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{self.base_url}/v3/collections")
            resp.raise_for_status()
            data = resp.json()
            collections = data.get("results", data.get("data", []))
            if isinstance(collections, dict):
                collections = collections.get("items", [])

            for col in collections:
                if col.get("name") == collection_name:
                    return col["id"]
        return None

    async def delete_collection(self, agent_id: str) -> bool:
        """Delete the R2R collection for the given agent. Does NOT create a collection if absent."""
        collection_id = await self._collection_id(agent_id)
        if collection_id is None:
            _collection_cache.pop(agent_id, None)
            return True
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
            import json

            files = {"file": (filename, file_content, "application/octet-stream")}
            data: dict[str, Any] = {}
            if metadata:
                data["metadata"] = json.dumps(metadata)

            # Try upload; on 409 (duplicate content), assign existing doc to collection
            resp = await client.post(
                f"{self.base_url}/v3/documents",
                files=files,
                data=data,
            )
            if resp.status_code == 409:
                error_text = resp.text
                match = re.search(r"Document\s+([0-9a-f-]+)\s+already exists", error_text)
                if match:
                    existing_id = match.group(1)
                    logger.info(f"R2R duplicate file (doc={existing_id}), assigning to collection {collection_id}")
                    assign_resp = await client.post(
                        f"{self.base_url}/v3/collections/{collection_id}/documents/{existing_id}",
                    )
                    if assign_resp.status_code not in (200, 201, 409):
                        raise RuntimeError(
                            f"Failed to assign existing document {existing_id} "
                            f"to collection {collection_id}: HTTP {assign_resp.status_code}"
                        )
                    logger.info(f"Assigned existing doc {existing_id} to collection {collection_id}")
                    return {"id": existing_id, "document_id": existing_id, "duplicate": True}
                logger.warning(f"R2R 409 but could not parse doc ID from: {error_text[:200]}")
            resp.raise_for_status()

            result = resp.json()
            doc = result.get("results", result.get("data", result))
            doc_id = doc.get("id", doc.get("document_id", ""))

            # Assign document to the agent's collection
            if doc_id:
                try:
                    assign_resp = await client.post(
                        f"{self.base_url}/v3/collections/{collection_id}/documents/{doc_id}",
                    )
                    if assign_resp.status_code not in (200, 201, 409):
                        logger.warning(
                            f"Assign doc {doc_id} to collection {collection_id} "
                            f"returned {assign_resp.status_code}: {assign_resp.text[:200]}"
                        )
                    else:
                        logger.info(f"Assigned doc {doc_id} to collection {collection_id}")
                except Exception as e:
                    logger.warning(f"Failed to assign document {doc_id} to collection: {e}")

            return doc

    async def ingest_text(
        self,
        agent_id: str,
        text: str,
        title: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Ingest raw text content (e.g., from URL scraping)."""
        collection_id = await self.ensure_collection(agent_id)

        import json as _json

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # Merge title into metadata
            merged_metadata = dict(metadata or {})
            if title:
                merged_metadata["title"] = title

            # R2R /v3/documents with form data: collection_ids, metadata as JSON strings
            data: dict[str, Any] = {
                "raw_text": text,
                "collection_ids": _json.dumps([collection_id]),
                "metadata": _json.dumps(merged_metadata),
                "ingestion_mode": "fast",
            }

            # Try ingest; on 409 (duplicate content), assign existing doc to collection
            resp = await client.post(
                f"{self.base_url}/v3/documents",
                data=data,
            )
            if resp.status_code == 409:
                error_text = resp.text
                match = re.search(r"Document\s+([0-9a-f-]+)\s+already exists", error_text)
                if match:
                    existing_id = match.group(1)
                    logger.info(f"R2R duplicate text (doc={existing_id}), assigning to collection {collection_id}")
                    assign_resp = await client.post(
                        f"{self.base_url}/v3/collections/{collection_id}/documents/{existing_id}",
                    )
                    if assign_resp.status_code not in (200, 201, 409):
                        raise RuntimeError(
                            f"Failed to assign existing document {existing_id} "
                            f"to collection {collection_id}: HTTP {assign_resp.status_code}"
                        )
                    logger.info(f"Assigned existing doc {existing_id} to collection {collection_id}")
                    return {"id": existing_id, "document_id": existing_id, "duplicate": True}
                logger.warning(f"R2R 409 but could not parse doc ID from: {error_text[:200]}")
            resp.raise_for_status()

            result = resp.json()
            doc = result.get("results", result.get("data", result))
            # Handle case where response is a list
            if isinstance(doc, list):
                doc = doc[0] if doc else {}
            doc_id = doc.get("id", doc.get("document_id", ""))

            # Assign document to the agent's collection (belt-and-suspenders)
            if doc_id:
                try:
                    assign_resp = await client.post(
                        f"{self.base_url}/v3/collections/{collection_id}/documents/{doc_id}",
                    )
                    if assign_resp.status_code not in (200, 201, 409):
                        logger.warning(
                            f"Assign doc {doc_id} to collection {collection_id} "
                            f"returned {assign_resp.status_code}: {assign_resp.text[:200]}"
                        )
                    else:
                        logger.info(f"Assigned doc {doc_id} to collection {collection_id}")
                except Exception as e:
                    logger.warning(f"Failed to assign document {doc_id} to collection: {e}")

            return doc

    async def unassign_document(self, agent_id: str, document_id: str) -> bool:
        """Remove a document from the agent's collection without deleting it globally."""
        collection_id = await self._collection_id(agent_id)
        if collection_id is None:
            return True
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(
                f"{self.base_url}/v3/collections/{collection_id}/documents/{document_id}"
            )
            if resp.status_code == 404:
                return True
            if resp.status_code not in (200, 204):
                logger.warning(
                    f"Failed to unassign document {document_id} from collection {collection_id}: "
                    f"HTTP {resp.status_code} - {resp.text[:200]}"
                )
                return False
            return True

    async def delete_document(self, document_id: str) -> bool:
        """Delete a document from R2R. Returns True if deleted or already gone."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(f"{self.base_url}/v3/documents/{document_id}")
            if resp.status_code == 404:
                return True  # Already deleted — desired state achieved
            return resp.status_code in (200, 204)

    async def list_documents(self, agent_id: str) -> list[dict[str, Any]]:
        """List all documents in the agent's collection. Does NOT create collection if absent."""
        collection_id = await self._collection_id(agent_id)
        if collection_id is None:
            return []

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
        threshold: float = 0.01,
    ) -> list[dict[str, Any]]:
        """Search the agent's collection. Returns results compatible with current format."""
        collection_id = await self.ensure_collection(agent_id)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            payload = {
                "query": query,
                "search_settings": {
                    "filters": {"collection_ids": {"$in": [collection_id]}},
                    "limit": top_k,
                    "use_hybrid_search": True,
                    "hybrid_settings": {
                        "semantic_weight": 0.6,
                        "full_text_weight": 0.4,
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

            logger.info(f"R2R search: collection={collection_id}, raw_results={len(results)}, threshold={threshold}")

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

            logger.info(f"R2R search: {len(normalized)} results above threshold {threshold}")
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
