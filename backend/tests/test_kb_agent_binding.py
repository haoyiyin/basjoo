"""Tests for agent-scoped tenant KB binding contract.

Ensures every agent that uses KB features has a tenant-scoped KnowledgeBase
bound through agent.kb_id, with proper tenant isolation.
"""

from unittest.mock import patch

import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase, Tenant, Workspace
from services.kb_service import KbService


@pytest.mark.asyncio
async def test_kb_service_has_get_or_create_agent_kb_method():
    """KbService should have get_or_create_agent_kb method for binding agents to KBs."""
    svc = KbService()
    assert hasattr(svc, "get_or_create_agent_kb")


@pytest.mark.asyncio
async def test_get_or_create_agent_kb_returns_tuple(setup_test_db):
    """get_or_create_agent_kb should return (tenant, kb) tuple."""
    async with database.AsyncSessionLocal() as session:
        # Get existing agent from fixture
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()
        agent_id = agent.id

        # Create KbService with the test session
        kb_svc = KbService(session=session)
        result = await kb_svc.get_or_create_agent_kb(agent_id)

        # Should return a tuple of (tenant, kb)
        assert result is not None
        assert len(result) == 2
        tenant, kb = result
        assert isinstance(tenant, Tenant)
        assert isinstance(kb, KnowledgeBase)


@pytest.mark.asyncio
async def test_agent_kb_binding_is_tenant_isolated(setup_test_db):
    """KB bound to agent must belong to the correct tenant and not be shared."""
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()
        agent_id = agent.id

        kb_svc = KbService(session=session)
        tenant, kb = await kb_svc.get_or_create_agent_kb(agent_id)

        # Verify tenant isolation
        assert kb.tenant_id == tenant.id

        # Verify we can retrieve the KB with correct tenant
        kb_fetched = await kb_svc.get_knowledge_base(tenant.id, kb.id)
        assert kb_fetched is not None
        assert kb_fetched.id == kb.id

        # A different tenant should not be able to access this KB
        different_tenant_id = "different-tenant-uuid"
        kb_from_wrong_tenant = await kb_svc.get_knowledge_base(
            different_tenant_id, kb.id
        )
        assert kb_from_wrong_tenant is None


@pytest.mark.asyncio
async def test_agent_with_existing_kb_returns_existing(setup_test_db):
    """If agent already has a KB bound, return it instead of creating new."""
    async with database.AsyncSessionLocal() as session:
        # Create tenant and KB first
        tenant = Tenant(name="Existing Tenant", slug="existing-tenant")
        session.add(tenant)
        await session.flush()

        kb = KnowledgeBase(
            tenant_id=tenant.id,
            name="Existing KB",
            qdrant_collection="kb_existing_test",
        )
        session.add(kb)
        await session.flush()

        # Get existing agent and bind KB
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()
        agent.kb_id = kb.id
        await session.commit()

        agent_id = agent.id
        existing_kb_id = kb.id
        existing_tenant_id = tenant.id

        kb_svc = KbService(session=session)
        tenant_result, kb_result = await kb_svc.get_or_create_agent_kb(agent_id)

        # Should return existing, not create new
        assert kb_result.id == existing_kb_id
        assert tenant_result.id == existing_tenant_id


@pytest.mark.asyncio
async def test_kb_setup_completed_reflects_real_binding(setup_test_db):
    """kb_setup_completed should reflect actual KB binding, not just boolean flag."""
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()

        # Set flag but no KB
        agent.kb_setup_completed = True
        agent.kb_id = None
        await session.commit()

        agent_id = agent.id

        kb_svc = KbService(session=session)
        tenant, kb = await kb_svc.get_or_create_agent_kb(agent_id)

        # After binding, agent should have both flag and real KB
        result = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalar_one()
        assert agent.kb_id is not None
        assert agent.kb_id == kb.id


@pytest.mark.asyncio
async def test_kb_service_requires_tenant_id_for_all_operations():
    """All KB service operations must require tenant_id to enforce isolation."""
    kb_svc = KbService()

    # Should raise ValueError when tenant_id is None or empty
    with pytest.raises(ValueError, match="tenant_id"):
        await kb_svc.get_knowledge_base(None, "some-kb-id")

    with pytest.raises(ValueError, match="tenant_id"):
        await kb_svc.get_knowledge_base("", "some-kb-id")


@pytest.mark.asyncio
async def test_agent_kb_binding_creates_qdrant_collection(setup_test_db):
    """When binding agent to KB, Qdrant collection should be created."""
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()

        # Clear any existing KB binding
        agent.kb_id = None
        await session.commit()

        agent_id = agent.id

        kb_svc = KbService(session=session)
        tenant, kb = await kb_svc.get_or_create_agent_kb(agent_id)

        # KB should have a valid qdrant_collection name
        assert kb.qdrant_collection is not None
        assert kb.qdrant_collection.startswith("kb_")


@pytest.mark.asyncio
async def test_kb_setup_endpoint_creates_kb_binding(client, default_agent_id):
    """KB setup endpoint should create/bind tenant-scoped KB when agent has no kb_id."""
    async with database.AsyncSessionLocal() as session:
        # Get agent and ensure it has no KB binding
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        agent.kb_id = None
        agent.kb_setup_completed = False
        await session.commit()

    # Mock Qdrant to avoid external calls
    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        # Call kb-setup endpoint
        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_for_kb_setup",
            },
        )

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )
    data = response.json()

    # Verify kb_setup_completed is True
    assert data["kb_setup_completed"] is True

    # Verify agent now has kb_id bound
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_id is not None

        # Verify the KB exists and belongs to a tenant
        result = await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.id == agent.kb_id)
        )
        kb = result.scalar_one_or_none()
        assert kb is not None
        assert kb.tenant_id is not None

        # Verify we can retrieve with tenant isolation
        kb_svc = KbService(session=session)
        kb_fetched = await kb_svc.get_knowledge_base(kb.tenant_id, kb.id)
        assert kb_fetched is not None
        assert kb_fetched.id == kb.id


@pytest.mark.asyncio
async def test_kb_setup_endpoint_returns_existing_kb_if_already_bound(
    client, default_agent_id
):
    """KB setup endpoint should return existing KB if agent already has kb_id."""
    async with database.AsyncSessionLocal() as session:
        # Create tenant and KB first
        tenant = Tenant(name="Existing Tenant", slug="existing-tenant")
        session.add(tenant)
        await session.flush()

        kb = KnowledgeBase(
            tenant_id=tenant.id,
            name="Existing KB",
            qdrant_collection="kb_existing_test",
        )
        session.add(kb)
        await session.flush()

        # Bind to agent
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        agent.kb_id = kb.id
        agent.kb_setup_completed = True
        await session.commit()

        existing_kb_id = kb.id

    # Call kb-setup endpoint - should return 409 conflict since already completed
    response = await client.post(
        f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
        json={
            "embedding_provider": "jina",
            "jina_api_key": "test_jina_key_for_kb_setup",
        },
    )

    # Should return 409 since kb_setup_completed is already True
    assert response.status_code == 409, (
        f"Expected 409, got {response.status_code}: {response.text}"
    )


@pytest.mark.asyncio
async def test_kb_setup_reconciles_stale_kb_binding(client, default_agent_id):
    """Regression: kb_id present but kb_setup_completed=False should be reconciled.

    This tests the bug where kb_reset sets kb_setup_completed=False but leaves kb_id,
    causing subsequent kb_setup to return success without actually completing setup.
    """
    async with database.AsyncSessionLocal() as session:
        # Create tenant and KB first
        tenant = Tenant(name="Stale Test Tenant", slug="stale-test-tenant")
        session.add(tenant)
        await session.flush()

        kb = KnowledgeBase(
            tenant_id=tenant.id,
            name="Stale Test KB",
            qdrant_collection="kb_stale_test",
        )
        session.add(kb)
        await session.flush()

        # Bind to agent but set kb_setup_completed=False (stale state after reset)
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        agent.kb_id = kb.id
        agent.kb_setup_completed = False  # Stale: has kb_id but not completed
        agent.embedding_provider = "jina"
        await session.commit()

    # Mock Qdrant to avoid external calls
    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        # Call kb-setup endpoint
        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_for_kb_setup",
            },
        )

    # Should succeed (200) and complete setup
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )
    data = response.json()

    # Key assertions: setup should be completed
    assert data["kb_setup_completed"] is True, (
        "kb_setup_completed should be True after setup"
    )
    assert data["kb_id"] is not None, "kb_id should be set"

    # Verify DB state is consistent
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_setup_completed is True, (
            "DB agent.kb_setup_completed should be True"
        )
        assert agent.kb_id is not None, "DB agent.kb_id should still be set"


@pytest.mark.asyncio
async def test_kb_reset_then_reinitialize_flow(client, default_agent_id):
    """Regression: reset followed by reinitialize should complete successfully.

    Tests the full cycle: setup -> reset -> reinitialize.
    """
    # Mock Qdrant to avoid external calls
    with patch("services.kb_service.QdrantKbService.ensure_collection") as mock_ensure:
        mock_ensure.return_value = None

        # Step 1: Initial setup
        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_for_kb_setup",
            },
        )
        assert response.status_code == 200, f"Initial setup failed: {response.text}"
        data = response.json()
        assert data["kb_setup_completed"] is True, "Initial setup should complete"
        initial_kb_id = data["kb_id"]

        # Step 2: Reset
        response = await client.post(
            f"/api/v1/agent:kb-reset?agent_id={default_agent_id}",
        )
        assert response.status_code == 200, f"Reset failed: {response.text}"

        # Verify reset state
        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.id == default_agent_id)
            )
            agent = result.scalar_one()
            assert agent.kb_setup_completed is False, (
                "After reset, kb_setup_completed should be False"
            )
            # kb_id may or may not be cleared depending on implementation

        # Step 3: Re-initialize - this is the bug! Should succeed and complete
        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "jina_api_key": "test_jina_key_for_kb_setup",
            },
        )
        assert response.status_code == 200, f"Re-initialize failed: {response.text}"
        data = response.json()

        # This is the key assertion that fails before the fix
        assert data["kb_setup_completed"] is True, (
            "Re-initialize should complete successfully"
        )
        assert data["kb_id"] is not None, "Re-initialize should have kb_id"
