"""Configurable URL scraping providers and concurrency guards."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import httpx

from config import settings
from services.scrapling_client import get_scrapling_client

logger = logging.getLogger(__name__)

_agent_semaphores: dict[str, asyncio.Semaphore] = {}
_workspace_semaphores: dict[int, asyncio.Semaphore] = {}
_lock = asyncio.Lock()


async def _get_agent_semaphore(agent_id: str) -> asyncio.Semaphore:
    async with _lock:
        if agent_id not in _agent_semaphores:
            _agent_semaphores[agent_id] = asyncio.Semaphore(
                max(1, settings.scraping_agent_concurrency)
            )
        return _agent_semaphores[agent_id]


async def _get_workspace_semaphore(workspace_id: int) -> asyncio.Semaphore:
    async with _lock:
        if workspace_id not in _workspace_semaphores:
            _workspace_semaphores[workspace_id] = asyncio.Semaphore(
                max(1, settings.scraping_workspace_concurrency)
            )
        return _workspace_semaphores[workspace_id]


async def _cloud_fetch(url: str) -> Dict[str, Any]:
    if not settings.cloud_scraping_api_url:
        return {"success": False, "error": "Cloud scraping API URL is not configured"}

    headers = {}
    if settings.cloud_scraping_api_key:
        headers["Authorization"] = f"Bearer {settings.cloud_scraping_api_key}"

    async with httpx.AsyncClient(timeout=settings.scraping_timeout_seconds) as client:
        response = await client.post(
            settings.cloud_scraping_api_url.rstrip("/"),
            json={"url": url, "timeout": settings.scraping_timeout_seconds},
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("success") and data.get("metadata") is None:
            data["metadata"] = {}
        if data.get("success"):
            data.setdefault("metadata", {})
            data["metadata"]["fetched_at"] = datetime.now(timezone.utc).isoformat()
            data["metadata"]["fetcher"] = "cloud_api"
        return data


async def fetch_with_provider(
    *,
    url: str,
    agent_id: str,
    workspace_id: int,
) -> Dict[str, Any]:
    """Fetch one URL with workspace/agent concurrency limits."""

    agent_sem = await _get_agent_semaphore(agent_id)
    workspace_sem = await _get_workspace_semaphore(workspace_id)

    async with workspace_sem:
        async with agent_sem:
            provider = (settings.scraping_provider or "local_scrapling").strip()
            if provider == "cloud_api":
                try:
                    return await _cloud_fetch(url)
                except Exception as exc:
                    logger.warning("Cloud scraping failed for %s: %s", url, exc)
                    return {"success": False, "error": str(exc)}

            local_result = await get_scrapling_client().fetch(url)
            if local_result.get("success"):
                return local_result

            if settings.scraping_fallback_to_cloud and settings.cloud_scraping_api_url:
                try:
                    cloud_result = await _cloud_fetch(url)
                    if cloud_result.get("success"):
                        return cloud_result
                except Exception as exc:
                    logger.warning("Cloud fallback scraping failed for %s: %s", url, exc)

            return local_result


async def discover_with_provider(
    *,
    url: str,
    agent_id: str,
    workspace_id: int,
    max_depth: int,
    max_pages: int,
) -> List[Tuple[str, int]]:
    """Discover subpages with the local Scrapling service for V1."""

    agent_sem = await _get_agent_semaphore(agent_id)
    workspace_sem = await _get_workspace_semaphore(workspace_id)
    async with workspace_sem:
        async with agent_sem:
            return await get_scrapling_client().discover_subpages(
                url, max_depth=max_depth, max_pages=max_pages
            )
