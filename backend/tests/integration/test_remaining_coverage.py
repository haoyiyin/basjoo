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



class TestJinaKeyUpdate:
    """Jina API key update still persists the key."""

    async def test_update_jina_key(
        self, client: AsyncClient, default_agent_id: str
    ):
        """Updating a Jina key should succeed."""
        resp = await client.put(
            f"/api/v1/agent:jina-key?agent_id={default_agent_id}",
            json={"jina_api_key": "new-test-key"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True


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
