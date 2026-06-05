"""Tests for KB indexing diagnostics gap.

Exposes the gap where URL/file list responses do not expose enough 
processor/indexing diagnostics for frontend to understand:
1. When fetch succeeds but KB processing fails
2. When a URL/file is still being processed vs fetch complete
3. What the actual processor error message is

These tests are intentionally RED - they document the expected behavior
that the current API does not provide.
"""

from unittest.mock import patch, AsyncMock
import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase, KbDocument, URLSource, Tenant


@pytest.mark.asyncio
async def test_url_list_exposes_indexing_error_when_fetch_succeeds_but_processing_fails(
    client, default_agent_id
):
    """URL fetch success + KB processing failure should expose error_message to API.
    
    Current gap: URLSource.last_error exists but is only set on fetch failure.
    When fetch succeeds but document processing fails, the error is only in 
    KbDocument.error_message, not exposed in URL list response.
    
    Expected: URL list response should include indexing_error or similar field
    when is_indexed=False but status='success'.
    """
    from models import URLSource
    import uuid

    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            new_kb_id = str(uuid.uuid4())
            kb = KnowledgeBase(
                id=new_kb_id,
                tenant_id=agent.workspace_id,
                name=f"Agent {default_agent_id} KB",
                embedding_model="BAAI/bge-m3",
                qdrant_collection=f"kb_{new_kb_id}",
            )
            session.add(kb)
            await session.flush()
            agent.kb_id = kb.id
        kb_id = agent.kb_id
        tenant_id = str(agent.workspace_id)

        # Create URL source: fetch succeeded but not indexed
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/fetch-ok-process-fail",
            normalized_url="https://example.com/fetch-ok-process-fail",
            status="success",  # Fetch succeeded
            is_indexed=False,  # But indexing failed
            title="Fetch OK Process Fail",
            content="Content was fetched successfully",
            last_error=None,  # No fetch error
        )
        session.add(url_source)
        await session.flush()

        # Create KbDocument with error status (simulating failed processing)
        doc = KbDocument(
            id=str(uuid.uuid4()),
            kb_id=kb_id,
            tenant_id=tenant_id,
            filename="url_content.txt",
            file_size=100,
            status="error",
            error_message="Embedding API rate limit exceeded",  # The real error
        )
        session.add(doc)
        await session.commit()

    # Fetch URL list via API
    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    # Find our URL in the list
    url_item = None
    for u in data["urls"]:
        if u["url"] == "https://example.com/fetch-ok-process-fail":
            url_item = u
            break

    assert url_item is not None, "URL should be in list"
    assert url_item["status"] == "success", "URL fetch status should be success"
    assert url_item["is_indexed"] is False, "is_indexed should be False"

    # EXPECTED BUT NOT IMPLEMENTED: URL should expose indexing error details
    # This assertion will FAIL until the API is enhanced
    assert "indexing_status" in url_item, (
        "GAP: URLItem should expose indexing_status field to distinguish "
        "fetch status from indexing status"
    )
    assert "indexing_error" in url_item, (
        "GAP: URLItem should expose indexing_error field when is_indexed=False "
        "but fetch succeeded, to show why indexing failed"
    )
    assert url_item["indexing_error"] == "Embedding API rate limit exceeded", (
        "GAP: indexing_error should contain the KbDocument.error_message"
    )


@pytest.mark.asyncio
async def test_url_list_shows_indexing_status_distinct_from_fetch_status(
    client, default_agent_id
):
    """URL list should distinguish fetch status from indexing status.
    
    Current gap: URLSource has status (pending/fetching/success/failed) and 
    is_indexed (bool), but no explicit indexing_status field.
    
    Expected: API should expose explicit indexing_status values like:
    - 'pending' (fetch success, waiting to index)
    - 'processing' (currently being indexed)
    - 'ready' (indexed successfully)
    - 'error' (indexing failed)
    """
    import uuid

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            new_kb_id = str(uuid.uuid4())
            kb = KnowledgeBase(
                id=new_kb_id,
                tenant_id=agent.workspace_id,
                name="Test KB",
                embedding_model="BAAI/bge-m3",
                qdrant_collection=f"kb_{new_kb_id}",
            )
            session.add(kb)
            await session.flush()
            agent.kb_id = kb.id
            await session.commit()

        # Create URL: fetch success, is_indexed=False (processing in progress)
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/processing-test",
            normalized_url="https://example.com/processing-test",
            status="success",
            is_indexed=False,
            title="Processing Test",
            content="Content fetched",
        )
        session.add(url_source)
        await session.commit()

    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    url_item = next(
        (u for u in data["urls"] if u["url"] == "https://example.com/processing-test"),
        None
    )
    assert url_item is not None

    # EXPECTED BUT NOT IMPLEMENTED: explicit indexing_status field
    assert "indexing_status" in url_item, (
        "GAP: URLItem should expose indexing_status field with values: "
        "'pending'|'processing'|'ready'|'error' to show actual KB processing state"
    )
    
    # The current boolean is_indexed doesn't distinguish between:
    # - "still being processed" (is_indexed=False, eventually will be True)
    # - "processing failed" (is_indexed=False, will stay False until fixed)
    assert url_item["indexing_status"] in ["pending", "processing", "ready", "error"], (
        "indexing_status should have explicit state values"
    )


@pytest.mark.asyncio
async def test_file_list_exposes_processing_error_message(client, default_agent_id):
    """File list should expose error_message for failed processing.
    
    Current gap: FileItem schema has error_message field, but the file list
    endpoint queries KbDocument which also has error_message. Need to verify
    that processor errors are properly propagated to the API response.
    
    Expected: When KbDocument.status='error', FileItem should include 
    the error_message from KbDocument.
    """
    import uuid
    from io import BytesIO

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService
            kb_svc = KbService(session=session)
            tenant = Tenant(name="test_tenant", slug="test_tenant")
            session.add(tenant)
            await session.flush()
            kb = await kb_svc.create_knowledge_base(
                tenant_id=str(tenant.id),
                name="Test KB",
            )
            agent.kb_id = kb.id
            await session.commit()

    # Upload a file
    test_content = b"Test content for file processing error test"
    files = {"files": ("error_test.txt", BytesIO(test_content), "text/plain")}

    response = await client.post(
        f"/api/v1/files:upload?agent_id={default_agent_id}",
        files=files,
    )
    assert response.status_code == 200
    upload_data = response.json()
    file_id = upload_data["files"][0]["id"]

    # Simulate a processing failure by directly updating the KbDocument
    async with database.AsyncSessionLocal() as session:
        # Find the KbDocument that was created
        result = await session.execute(
            select(KbDocument).where(KbDocument.id == file_id)
        )
        doc = result.scalar_one_or_none()
        if doc:
            object.__setattr__(doc, "status", "error")
            object.__setattr__(doc, "error_message", "PDF parsing failed: malformed file")
            await session.commit()

    # Get file list
    response = await client.get(f"/api/v1/files:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    file_item = next((f for f in data["files"] if f["id"] == file_id), None)
    assert file_item is not None, "File should be in list"

    # File status should reflect KbDocument status
    # EXPECTED BUT MAY NOT BE IMPLEMENTED: proper error propagation
    if file_item.get("status") == "failed" or file_item.get("status") == "error":
        assert "error_message" in file_item, (
            "GAP: FileItem with failed/error status must include error_message field"
        )
        assert file_item["error_message"] == "PDF parsing failed: malformed file", (
            "GAP: error_message should contain the KbDocument.error_message"
        )
    else:
        # If status is still 'pending' or 'processing', this documents the gap
        pytest.fail(
            f"GAP: File status '{file_item.get('status')}' does not reflect "
            f"KbDocument status 'error'. FileItem should expose processing status "
            f"distinct from upload status."
        )


@pytest.mark.asyncio
async def test_file_list_shows_processing_status(client, default_agent_id):
    """File list should show explicit processing status (pending/processing/ready/error).
    
    Current gap: FileItem.status has values like 'uploading', 'processing', 'ready', 
    'failed', 'pending' but these may not map cleanly to KbDocument status.
    
    Expected: File list should clearly show:
    - 'pending' = uploaded, waiting to process
    - 'processing' = currently being chunked/embed/upsert
    - 'ready' = successfully indexed
    - 'error' = processing failed with error_message
    """
    import uuid
    from io import BytesIO

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService
            kb_svc = KbService(session=session)
            tenant = Tenant(name="test_tenant2", slug="test_tenant2")
            session.add(tenant)
            await session.flush()
            kb = await kb_svc.create_knowledge_base(
                tenant_id=str(tenant.id),
                name="Test KB 2",
            )
            agent.kb_id = kb.id
            await session.commit()

    # Upload a file
    test_content = b"Test content for processing status test"
    files = {"files": ("processing_test.txt", BytesIO(test_content), "text/plain")}

    response = await client.post(
        f"/api/v1/files:upload?agent_id={default_agent_id}",
        files=files,
    )
    assert response.status_code == 200
    upload_data = response.json()
    file_id = upload_data["files"][0]["id"]

    # Set document to processing state
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(KbDocument).where(KbDocument.id == file_id)
        )
        doc = result.scalar_one_or_none()
        if doc:
            object.__setattr__(doc, "status", "processing")
            await session.commit()

    # Get file list
    response = await client.get(f"/api/v1/files:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    file_item = next((f for f in data["files"] if f["id"] == file_id), None)
    assert file_item is not None

    # EXPECTED: status should be 'processing' to match KbDocument
    # ACTUAL: may be different depending on implementation
    if file_item.get("status") != "processing":
        pytest.fail(
            f"GAP: File status '{file_item.get('status')}' does not match "
            f"KbDocument status 'processing'. The API should expose accurate "
            f"processing state for files being indexed."
        )


@pytest.mark.asyncio
async def test_url_response_includes_last_error_for_fetch_failures(client, default_agent_id):
    """URL list should expose last_error when fetch failed.
    
    This tests current behavior - URLSource.last_error should already be exposed.
    If this fails, it documents another gap.
    """
    import uuid

    async with database.AsyncSessionLocal() as session:
        # Create URL with fetch failure
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/fetch-fail",
            normalized_url="https://example.com/fetch-fail",
            status="failed",
            is_indexed=False,
            last_error="Connection timeout after 30s",
        )
        session.add(url_source)
        await session.commit()

    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    url_item = next(
        (u for u in data["urls"] if u["url"] == "https://example.com/fetch-fail"),
        None
    )
    assert url_item is not None
    assert url_item["status"] == "failed"
    
    # Check if last_error is exposed (may or may not be in current schema)
    if "last_error" not in url_item:
        pytest.fail(
            "GAP: URLItem should expose last_error field when status='failed' "
            "to show why the fetch failed"
        )
    assert url_item["last_error"] == "Connection timeout after 30s"
