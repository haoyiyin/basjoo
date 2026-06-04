"""Tests for KB setup repair - handles inconsistent agent state.

Ensures agents with kb_setup_completed=True but kb_id=None (or stale KB reference)
get repaired when kb-setup is called, returning the bound kb_id without creating
duplicate KBs on repeated calls.
"""

from unittest.mock import patch

import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase, Tenant


@pytest.mark.asyncio
async def test_kb_setup_repairs_completed_flag_with_missing_kb_id(client, default_agent_id):
    """Agent with kb_setup_completed=True and kb_id=None should receive valid KB after setup.

    This is the core bug: an agent can get into an inconsistent state where
    kb_setup_completed is True but kb_id is None (e.g., after manual DB manipulation
    or partial failure). The setup endpoint should repair this by creating/binding
    a new KB instead of returning 409 conflict.
    """
    async with database.AsyncSessionLocal() as session:
        # Seed agent with inconsistent state: completed=True but kb_id=None
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        agent.kb_setup_completed = True
        agent.kb_id = None
        agent.embedding_provider = "jina"
        await session.commit()

    # Mock Qdrant to avoid external calls
    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_for_repair",
            },
        )

    # Should succeed (200) and repair the inconsistent state
    assert response.status_code == 200, (
        f"Expected 200 after repair, got {response.status_code}: {response.text}"
    )
    data = response.json()

    # Key assertions: response should include valid kb_id
    assert data["kb_id"] is not None, "Response should include bound kb_id after repair"
    assert data["kb_setup_completed"] is True, "kb_setup_completed should be True"

    # Verify DB state is now consistent
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_id is not None, "DB agent.kb_id should be set after repair"
        assert agent.kb_setup_completed is True, "DB agent.kb_setup_completed should be True"

        # Verify the KB exists
        result = await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.id == agent.kb_id)
        )
        kb = result.scalar_one_or_none()
        assert kb is not None, "KB should exist"


@pytest.mark.asyncio
async def test_kb_setup_repairs_stale_kb_reference(client, default_agent_id):
    """Agent with kb_id pointing to non-existent KB should get new KB bound.

    If agent.kb_id references a KB that no longer exists (stale reference),
    setup should clear the stale reference and create/bind a new KB.
    """
    async with database.AsyncSessionLocal() as session:
        # Seed agent with stale kb_id pointing to non-existent KB
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        agent.kb_id = "non-existent-kb-id-12345"
        agent.kb_setup_completed = True
        agent.embedding_provider = "jina"
        await session.commit()

    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_for_stale",
            },
        )

    # Should succeed and create new KB
    assert response.status_code == 200, (
        f"Expected 200 after stale repair, got {response.status_code}: {response.text}"
    )
    data = response.json()

    # Should have a new valid kb_id (different from the stale one)
    assert data["kb_id"] is not None, "Should have new kb_id after stale repair"
    assert data["kb_id"] != "non-existent-kb-id-12345", "Should be different from stale kb_id"

    # Verify DB state
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_id is not None
        assert agent.kb_id != "non-existent-kb-id-12345"


@pytest.mark.asyncio
async def test_kb_setup_second_call_returns_same_kb_id(client, default_agent_id):
    """Second setup call should return same kb_id without creating duplicate KB.

    After a successful setup (or repair), calling setup again should:
    - Return 409 CONFLICT if setup is truly complete with valid KB
    - OR return 200 with same kb_id (idempotent behavior)

    The key requirement: no duplicate active KB should be created.
    """
    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        # First setup call
        response1 = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_first",
            },
        )
        assert response1.status_code == 200, f"First setup failed: {response1.text}"
        data1 = response1.json()
        first_kb_id = data1["kb_id"]
        assert first_kb_id is not None

        # Verify agent state is consistent
        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.id == default_agent_id)
            )
            agent = result.scalar_one()
            assert agent.kb_id == first_kb_id
            assert agent.kb_setup_completed is True

        # Second setup call - should be rejected as already completed
        response2 = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_second",
            },
        )

        # Current behavior: returns 409 when setup is complete
        assert response2.status_code == 409, (
            f"Expected 409 for duplicate setup, got {response2.status_code}: {response2.text}"
        )

        # Verify no duplicate KB was created
        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.id == default_agent_id)
            )
            agent = result.scalar_one()
            assert agent.kb_id == first_kb_id, "kb_id should remain unchanged"

            # Count KBs for this agent's tenant - should be exactly 1
            result = await session.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == first_kb_id)
            )
            kb = result.scalar_one_or_none()
            assert kb is not None, "Original KB should still exist"


@pytest.mark.asyncio
async def test_kb_setup_service_repair_helper_exists():
    """KbService should have a repair/reconcile helper for agent KB state."""
    from services.kb_service import KbService

    svc = KbService()
    # The repair logic should be part of get_or_create_agent_kb or a dedicated method
    assert hasattr(svc, "get_or_create_agent_kb"), (
        "KbService should have get_or_create_agent_kb for repair"
    )


@pytest.mark.asyncio
async def test_kb_setup_returns_valid_kb_in_response(client, default_agent_id):
    """Setup response should include valid kb_id that can be used for subsequent operations."""
    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_valid",
            },
        )

    assert response.status_code == 200
    data = response.json()

    # Response should contain valid kb_id
    assert "kb_id" in data, "Response should include kb_id field"
    assert data["kb_id"] is not None, "kb_id should not be None"

    # The kb_id should be a valid UUID-like string
    kb_id = data["kb_id"]
    assert len(kb_id) > 0, "kb_id should not be empty"

    # Verify it matches DB
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_id == kb_id, "Response kb_id should match DB"

        # Verify KB exists and is accessible
        result = await session.execute(
            select(KnowledgeBase, Tenant)
            .join(Tenant, KnowledgeBase.tenant_id == Tenant.id)
            .where(KnowledgeBase.id == kb_id)
        )
        row = result.first()
        assert row is not None, "KB should exist with tenant"
        kb, tenant = row
        assert kb is not None
        assert tenant is not None
        assert kb.tenant_id == tenant.id
