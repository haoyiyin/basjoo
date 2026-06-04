"""Tests for index:info endpoint - includes files_indexed count.

RED: Tests expect files_indexed field but current implementation only returns urls_indexed.
"""

import pytest
import pytest_asyncio
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase, KbDocument, Tenant, Workspace, WorkspaceQuota


@pytest_asyncio.fixture(loop_scope="function")
async def agent_with_ready_files(setup_test_db):
    """Create an agent with KB and ready KbDocuments."""
    async with database.AsyncSessionLocal() as session:
        # Get or create workspace
        workspace_result = await session.execute(
            select(Workspace).order_by(Workspace.id).limit(1)
        )
        workspace = workspace_result.scalar_one_or_none()
        if not workspace:
            workspace = Workspace(name="Test Workspace", owner_email="test@example.com")
            session.add(workspace)
            await session.flush()
            session.add(WorkspaceQuota(workspace_id=workspace.id))

        # Create tenant
        tenant = Tenant(name="Test Tenant", slug="test-tenant")
        session.add(tenant)
        await session.flush()

        # Create agent
        agent = Agent(
            workspace_id=workspace.id,
            name="Test Agent with Files",
            description="Agent with ready files",
            model="deepseek-chat",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            jina_api_key="test_jina_key",
        )
        session.add(agent)
        await session.flush()

        # Create knowledge base
        kb = KnowledgeBase(
            tenant_id=tenant.id,
            name=f"KB for {agent.id}",
            embedding_model="BAAI/bge-m3",
            qdrant_collection=f"kb_{agent.id}",
            chunk_size=512,
            chunk_overlap=64,
        )
        session.add(kb)
        await session.flush()

        # Bind KB to agent
        agent.kb_id = kb.id
        agent.kb_setup_completed = True
        await session.commit()

        # Create ready files
        doc1 = KbDocument(
            kb_id=kb.id,
            tenant_id=tenant.id,
            filename="ready_file_1.pdf",
            file_type="pdf",
            status="ready",
            file_size=102400,
            chunk_count=10,
        )
        doc2 = KbDocument(
            kb_id=kb.id,
            tenant_id=tenant.id,
            filename="ready_file_2.txt",
            file_type="txt",
            status="ready",
            file_size=51200,
            chunk_count=5,
        )
        doc3 = KbDocument(
            kb_id=kb.id,
            tenant_id=tenant.id,
            filename="processing_file.docx",
            file_type="docx",
            status="processing",
            file_size=204800,
            chunk_count=0,
        )

        session.add_all([doc1, doc2, doc3])
        await session.commit()

        yield {
            "agent_id": agent.id,
            "kb_id": kb.id,
            "ready_count": 2,
        }


@pytest.mark.asyncio
async def test_index_info_includes_files_indexed(client, agent_with_ready_files):
    """Test that index:info includes files_indexed field with correct count."""
    agent_id = agent_with_ready_files["agent_id"]
    expected_ready_count = agent_with_ready_files["ready_count"]

    response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()

    # Response should include files_indexed field
    assert "files_indexed" in data, (
        f"Response missing 'files_indexed' field. Got keys: {list(data.keys())}"
    )

    # Should count only ready documents
    assert data["files_indexed"] == expected_ready_count, (
        f"Expected files_indexed={expected_ready_count}, got {data['files_indexed']}"
    )

    # Other fields should still be present
    assert "urls_indexed" in data
    assert "index_exists" in data
    assert "status" in data
    assert data["agent_id"] == agent_id
    assert data["index_exists"] is True


@pytest.mark.asyncio
async def test_index_info_no_kb_returns_zero_files(client, default_agent_id):
    """Test that index:info returns files_indexed=0 when agent has no KB."""
    response = await client.get(f"/api/v1/index:info?agent_id={default_agent_id}")

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()

    # Should include files_indexed even when no KB
    assert "files_indexed" in data, (
        f"Response missing 'files_indexed' field. Got keys: {list(data.keys())}"
    )
    assert data["files_indexed"] == 0, (
        f"Expected files_indexed=0 when no KB, got {data['files_indexed']}"
    )


@pytest.mark.asyncio
async def test_index_info_requires_auth(public_client, agent_with_ready_files):
    """Test that index:info requires authentication."""
    agent_id = agent_with_ready_files["agent_id"]

    response = await public_client.get(f"/api/v1/index:info?agent_id={agent_id}")

    assert response.status_code == 401 or response.status_code == 403, (
        f"Expected 401/403 for unauthenticated request, got {response.status_code}"
    )
