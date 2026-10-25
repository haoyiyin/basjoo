"""Tests for sources:summary endpoint - KbDocument-based file counts.

RED: Tests expect KbDocument counts but current implementation uses deprecated KnowledgeFile.

Since the KB-decoupling change a KB is scoped by `workspace_id`; `tenant_id` is
legacy and unused, so nothing here creates a Tenant row.
"""

import pytest
import pytest_asyncio
from sqlalchemy import select

import database
from models import Agent, KbDocument, Workspace, WorkspaceQuota
from tests.conftest import make_test_kb

@pytest_asyncio.fixture(loop_scope="function")
async def agent_with_kb_docs(setup_test_db):
    """Create an agent with KB and KbDocuments of various statuses."""
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
            name="Test Agent with KB",
            description="Agent with KB documents",
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

        # Create KbDocuments with different statuses
        doc_ready_1 = KbDocument(
            kb_id=kb_id,
            filename="ready_file_1.pdf",
            file_type="pdf",
            status="ready",
            file_size=102400,  # 100 KB
            chunk_count=10,
        )
        doc_ready_2 = KbDocument(
            kb_id=kb_id,
            filename="ready_file_2.txt",
            file_type="txt",
            status="ready",
            file_size=51200,  # 50 KB
            chunk_count=5,
        )
        doc_processing = KbDocument(
            kb_id=kb_id,
            filename="processing_file.docx",
            file_type="docx",
            status="processing",
            file_size=204800,  # 200 KB
            chunk_count=0,
        )
        doc_pending = KbDocument(
            kb_id=kb_id,
            filename="pending_file.xlsx",
            file_type="xlsx",
            status="pending",
            file_size=102400,  # 100 KB
            chunk_count=0,
        )
        doc_error = KbDocument(
            kb_id=kb_id,
            filename="error_file.pdf",
            file_type="pdf",
            status="error",
            file_size=51200,  # 50 KB
            chunk_count=0,
            error_message="Failed to parse",
        )

        session.add_all(
            [doc_ready_1, doc_ready_2, doc_processing, doc_pending, doc_error]
        )
        await session.commit()

    yield {
        "agent_id": agent_id,
        "kb_id": kb_id,
        "workspace_id": workspace_id,
        "docs": {
            "ready": [doc_ready_1.id, doc_ready_2.id],
            "processing": [doc_processing.id],
            "pending": [doc_pending.id],
            "error": [doc_error.id],
        },
        "total_size": 102400
        + 51200
        + 204800
        + 102400
        + 51200,  # 512000 bytes = 500 KB
    }

@pytest.mark.asyncio
async def test_sources_summary_returns_kb_document_counts(client, agent_with_kb_docs):
    """Test that sources:summary returns KbDocument counts instead of deprecated KnowledgeFile."""
    agent_id = agent_with_kb_docs["agent_id"]
    total_size_kb = round(agent_with_kb_docs["total_size"] / 1024, 2)

    response = await client.get(f"/api/v1/sources:summary?agent_id={agent_id}")

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()
    assert "urls" in data
    assert "files" in data
    assert "has_pending" in data

    # File stats should reflect KbDocuments, not deprecated KnowledgeFile
    files = data["files"]
    assert files["total"] == 5, f"Expected total 5 KbDocuments, got {files['total']}"
    assert files["ready"] == 2, f"Expected 2 ready documents, got {files['ready']}"
    assert files["processing"] == 2, (
        f"Expected 2 processing documents (processing + pending), got {files['processing']}"
    )

    # Total size should include all documents
    expected_total_kb = round(total_size_kb, 2)
    assert files["total_size_kb"] == pytest.approx(expected_total_kb, rel=0.01), (
        f"Expected total_size_kb ~{expected_total_kb}, got {files['total_size_kb']}"
    )

@pytest.mark.asyncio
async def test_sources_summary_with_no_kb(client, default_agent_id):
    """Test that sources:summary returns zero file stats when agent has no KB."""
    # Use default agent which may not have KB
    response = await client.get(f"/api/v1/sources:summary?agent_id={default_agent_id}")

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()
    assert data["files"]["total"] == 0
    assert data["files"]["ready"] == 0
    assert data["files"]["processing"] == 0
    assert data["files"]["total_size_kb"] == 0

@pytest.mark.asyncio
async def test_sources_summary_counts_every_document_of_the_kb(
    client, agent_with_kb_docs
):
    """Counts are scoped by kb_id alone — the KB is the only boundary.

    Replaces `test_sources_summary_filters_by_tenant_id`, which inserted a
    document with the same `kb_id` but a foreign `tenant_id` and asserted it was
    NOT counted. `Tenant` has left the KB request path, so a document attached to
    the KB is a document of the KB and must be counted.
    """
    agent_id = agent_with_kb_docs["agent_id"]
    kb_id = agent_with_kb_docs["kb_id"]

    async with database.AsyncSessionLocal() as session:
        session.add(
            KbDocument(
                kb_id=kb_id,  # Same KB
                filename="attached_file.pdf",
                file_type="pdf",
                status="ready",
                file_size=99999,
                chunk_count=1,
            )
        )
        await session.commit()

    response = await client.get(f"/api/v1/sources:summary?agent_id={agent_id}")

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()
    files = data["files"]

    assert files["total"] == 6, (
        f"Expected total 6 KbDocuments (kb_id-scoped), got {files['total']}. "
        f"Every document attached to kb_id={kb_id} must be counted."
    )
    assert files["ready"] == 3, (
        f"Expected 3 ready documents (kb_id-scoped), got {files['ready']}"
    )

    # The document is visible through the KB, with no tenant column involved.
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(KbDocument).where(KbDocument.filename == "attached_file.pdf")
        )
        doc = result.scalar_one_or_none()
        assert doc is not None, "Attached document should exist in DB"
        assert doc.kb_id == kb_id, "Attached doc should have the KB's id"
        assert doc.tenant_id is None, "Documents carry no tenant since the decoupling"

@pytest.mark.asyncio
async def test_sources_summary_requires_auth(public_client, agent_with_kb_docs):
    """Test that sources:summary requires authentication."""
    agent_id = agent_with_kb_docs["agent_id"]

    response = await public_client.get(f"/api/v1/sources:summary?agent_id={agent_id}")

    assert response.status_code == 401 or response.status_code == 403, (
        f"Expected 401/403 for unauthenticated request, got {response.status_code}"
    )
