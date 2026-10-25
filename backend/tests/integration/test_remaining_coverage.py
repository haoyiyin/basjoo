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



class TestEmbeddingKeyLivesOnKnowledgeBase:
    """Embedding keys moved to the KB; the agent no longer carries them."""

    async def test_agent_payload_has_no_embedding_fields(
        self, client: AsyncClient, default_agent_id: str
    ):
        resp = await client.get(f"/api/v1/agent?agent_id={default_agent_id}")
        assert resp.status_code == 200
        data = resp.json()
        for removed in (
            "embedding_provider",
            "embedding_api_base",
            "embedding_model",
            "embedding_batch_size",
            "embedding_api_key_set",
            "jina_api_key_set",
            "jina_api_key_masked",
            "siliconflow_api_key_set",
            "siliconflow_api_key_masked",
            "kb_setup_completed",
        ):
            assert removed not in data, f"{removed} must be gone from the agent payload"
        assert "kb_id" in data
        assert "kb_name" in data
        assert "kb_status" in data

    async def test_agent_jina_key_endpoint_is_gone(
        self, client: AsyncClient, default_agent_id: str
    ):
        resp = await client.put(
            f"/api/v1/agent:jina-key?agent_id={default_agent_id}",
            json={"jina_api_key": "new-test-key"},
        )
        assert resp.status_code in (404, 405, 422)

    async def test_kb_test_embedding_requires_super_admin(
        self, support_client: AsyncClient
    ):
        resp = await support_client.post(
            "/api/v1/knowledge-bases/test-embedding",
            json={
                "embedding_provider": "jina",
                "embedding_model": "jina-embeddings-v3",
                "embedding_api_key": "test-key",
            },
        )
        assert resp.status_code == 403


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
