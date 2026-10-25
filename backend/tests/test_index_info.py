"""Tests for index:info endpoint - includes files_indexed count.

RED: Tests expect files_indexed field but current implementation only returns urls_indexed.

Since the KB-decoupling change a KB is scoped by `workspace_id` and `tenant_id` is
legacy and unused, so nothing here creates a Tenant row.
"""

import pytest
import pytest_asyncio
from sqlalchemy import select

import database
from models import Agent, KbDocument, Workspace, WorkspaceQuota
from tests.conftest import make_test_kb

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
            await session.commit()
        workspace_id = workspace.id

    async with database.AsyncSessionLocal() as session:
        # Create agent
        agent = Agent(
            workspace_id=workspace_id,
            name="Test Agent with Files",
            description="Agent with ready files",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent)
        await session.commit()
        agent_id = agent.id

    # Build the KB row through the shared fixture helper: it carries the
    # workspace scope and an encrypted key without a Qdrant round trip.
    kb = make_test_kb(workspace_id, f"KB for {agent_id}")

    async with database.AsyncSessionLocal() as session:
        session.add(kb)
        await session.flush()
        kb_id = kb.id

        # Bind KB to agent
        agent = await session.get(Agent, agent_id)
        agent.kb_id = kb_id
        await session.commit()

        # Create ready files
        doc1 = KbDocument(
            kb_id=kb_id,
            filename="ready_file_1.pdf",
            file_type="pdf",
            status="ready",
            file_size=102400,
            chunk_count=10,
        )
        doc2 = KbDocument(
            kb_id=kb_id,
            filename="ready_file_2.txt",
            file_type="txt",
            status="ready",
            file_size=51200,
            chunk_count=5,
        )
        doc3 = KbDocument(
            kb_id=kb_id,
            filename="processing_file.docx",
            file_type="docx",
            status="processing",
            file_size=204800,
            chunk_count=0,
        )

        session.add_all([doc1, doc2, doc3])
        await session.commit()

    yield {
        "agent_id": agent_id,
        "kb_id": kb_id,
        "workspace_id": workspace_id,
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
async def test_index_info_counts_every_document_of_the_kb(
    client, agent_with_ready_files
):
    """files_indexed is scoped by kb_id alone — the KB is the only boundary.

    Replaces `test_index_info_filters_by_tenant_id`, which inserted a document
    with the same `kb_id` but a foreign `tenant_id` and asserted it was NOT
    counted. `Tenant` has left the KB request path, so there is no second axis to
    filter on: a document attached to the KB is a document of the KB.
    """
    agent_id = agent_with_ready_files["agent_id"]
    kb_id = agent_with_ready_files["kb_id"]

    async with database.AsyncSessionLocal() as session:
        session.add(
            KbDocument(
                kb_id=kb_id,
                filename="attached_ready.pdf",
                file_type="pdf",
                status="ready",
                file_size=99999,
                chunk_count=1,
            )
        )
        await session.commit()

    response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()

    # 2 seeded ready docs + 1 added here; the processing doc still does not count.
    assert data["files_indexed"] == 3, (
        f"Expected files_indexed=3 (kb_id-scoped), got {data['files_indexed']}. "
        f"Every document attached to kb_id={kb_id} must be counted."
    )

@pytest.mark.asyncio
async def test_index_info_requires_auth(public_client, agent_with_ready_files):
    """Test that index:info requires authentication."""
    agent_id = agent_with_ready_files["agent_id"]

    response = await public_client.get(f"/api/v1/index:info?agent_id={agent_id}")

    assert response.status_code == 401 or response.status_code == 403, (
        f"Expected 401/403 for unauthenticated request, got {response.status_code}"
    )
