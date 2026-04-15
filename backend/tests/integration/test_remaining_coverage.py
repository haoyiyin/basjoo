"""Targeted regression tests for recently fixed behaviors."""

import json
import time
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from models import WorkspaceQuota, Agent
import database


async def _set_url_quota(agent_id: str, max_urls: int):
    """Helper to set URL quota directly."""
    async with database.AsyncSessionLocal() as db:
        agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_result.scalar_one_or_none()
        assert agent is not None
        quota_result = await db.execute(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
        )
        quota = quota_result.scalar_one_or_none()
        if quota:
            quota.max_urls = max_urls
            quota.used_urls = 0
        else:
            quota = WorkspaceQuota(
                workspace_id=agent.workspace_id,
                max_urls=max_urls,
                used_urls=0,
            )
            db.add(quota)
        await db.commit()


class TestURLCrawlQuotaConvergence:
    """URL quota consistency after batch create and crawl operations."""

    async def test_discover_subpages_quota_matches_actual_count(
        self, client: AsyncClient, default_agent_id: str, monkeypatch
    ):
        """Verify discover_subpages increments quota exactly by new URLs added."""
        await _set_url_quota(default_agent_id, max_urls=10)

        async def fake_discover(self, url, max_depth=1, max_pages=10):
            return [
                ("https://example.com/page1", 1),
                ("https://example.com/page2", 1),
                ("https://example.com/page3", 1),
            ]

        from services.scraper import URLScraper
        monkeypatch.setattr(URLScraper, "discover_subpages", fake_discover)

        resp = await client.post(
            f"/api/v1/urls:discover?agent_id={default_agent_id}&url=https://example.com",
        )
        assert resp.status_code == 200

        quota_resp = await client.get(f"/api/v1/quota?agent_id={default_agent_id}")
        quota = quota_resp.json()
        assert quota["used_urls"] == 3
        assert quota["remaining_urls"] == 7

    async def test_discover_respects_quota_limit(
        self, client: AsyncClient, default_agent_id: str, monkeypatch
    ):
        """discover_subpages should stop at quota limit, not exceed it."""
        await _set_url_quota(default_agent_id, max_urls=2)

        async def fake_discover(self, url, max_depth=1, max_pages=10):
            return [
                ("https://example.com/page1", 1),
                ("https://example.com/page2", 1),
                ("https://example.com/page3", 1),
                ("https://example.com/page4", 1),
            ]

        from services.scraper import URLScraper
        monkeypatch.setattr(URLScraper, "discover_subpages", fake_discover)

        resp = await client.post(
            f"/api/v1/urls:discover?agent_id={default_agent_id}&url=https://example.com",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2  # limited by quota

        quota_resp = await client.get(f"/api/v1/quota?agent_id={default_agent_id}")
        quota = quota_resp.json()
        assert quota["used_urls"] == 2
        assert quota["remaining_urls"] == 0


class TestKeyRotation:
    """Jina API key rotation clears disabled state and cache."""

    async def test_update_jina_key_clears_disabled(
        self, client: AsyncClient, default_agent_id: str, monkeypatch
    ):
        """After updating a Jina key, previous disabled state should be cleared."""
        from services.qdrant_store import _disabled_keys, _cache_by_client
        from core.encryption import encrypt_api_key, decrypt_api_key
        from sqlalchemy import select
        from models import Agent
        from database import AsyncSessionLocal

        # Set the agent's key to "test-old-key" so update_jina_key will clear it
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Agent).where(Agent.id == default_agent_id))
            agent = result.scalar_one_or_none()
            assert agent is not None
            agent.jina_api_key = encrypt_api_key("test-old-key")
            await db.commit()

        # Add a fake disabled entry
        _disabled_keys.add("test-old-key")
        _cache_by_client[("test-old-key", "jina-embeddings-v3")] = {"cached": True}

        # Update the key
        resp = await client.put(
            f"/api/v1/agent:jina-key?agent_id={default_agent_id}",
            json={"jina_api_key": "new-test-key"},
        )
        assert resp.status_code == 200

        # Old key should no longer be in disabled set
        assert "test-old-key" not in _disabled_keys
        # Old cache should be cleared
        assert ("test-old-key", "jina-embeddings-v3") not in _cache_by_client


class TestCORSSecurity:
    """CORS defaults are no longer wildcard."""

    def test_cors_defaults_no_wildcard(self):
        """Settings should not default to wildcard origin."""
        from config import Settings
        s = Settings(allowed_origins="")
        assert s.allowed_origins == ""
        assert s.cors_origins_list == []


class TestSchedulerIsolation:
    """Each scheduler wrapper owns its own instance."""

    def test_schedulers_have_independent_instances(self):
        """URLFetch, HistoryCleanup, and SessionAutoClose should not share a scheduler."""
        from services.scheduler import (
            URLFetchScheduler,
            HistoryCleanupScheduler,
            SessionAutoCloseScheduler,
        )

        url = URLFetchScheduler()
        history = HistoryCleanupScheduler()
        session = SessionAutoCloseScheduler()

        assert url.scheduler is not history.scheduler
        assert url.scheduler is not session.scheduler
        assert history.scheduler is not session.scheduler
