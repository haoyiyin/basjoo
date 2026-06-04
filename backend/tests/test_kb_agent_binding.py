"""Tests for agent-scoped tenant KB binding contract.

Ensures every agent that uses KB features has a tenant-scoped KnowledgeBase
bound through agent.kb_id, with proper tenant isolation.
"""

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
            select(Agent).where(Agent.is_active == True).order_by(Agent.created_at).limit(1)
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
            select(Agent).where(Agent.is_active == True).order_by(Agent.created_at).limit(1)
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
        kb_from_wrong_tenant = await kb_svc.get_knowledge_base(different_tenant_id, kb.id)
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
            select(Agent).where(Agent.is_active == True).order_by(Agent.created_at).limit(1)
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
            select(Agent).where(Agent.is_active == True).order_by(Agent.created_at).limit(1)
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
            select(Agent).where(Agent.is_active == True).order_by(Agent.created_at).limit(1)
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
