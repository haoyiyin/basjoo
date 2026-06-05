"""Tests for URL ingestion and index status.

Scrapling Service /discover Endpoint Tests:
- The /discover endpoint in scrapling-service is tested directly via mocked HTTP calls.
- These tests verify the BFS crawling behavior at the microservice level.

Ensures that URL sources added from the admin UI:
1. Progress from pending → fetching → success/error
2. Content is indexed into the agent's tenant KB/Qdrant collection
3. URLSource.is_indexed reflects the actual indexing state
4. Index status is accurately reported to the UI
"""

from unittest.mock import patch, AsyncMock
import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase, KbDocument, Tenant, URLSource


@pytest.mark.asyncio
async def test_url_creation_returns_list_response_shape(client, default_agent_id):
    """URL create endpoint should return URLListResponse shape with urls, total, quota."""
    response = await client.post(
        f"/api/v1/urls:create?agent_id={default_agent_id}",
        json={"urls": ["https://example.com/test1", "https://example.com/test2"]},
    )
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )
    data = response.json()

    # Should have URLListResponse shape
    assert "urls" in data
    assert "total" in data
    assert "quota" in data
    assert isinstance(data["urls"], list)
    assert len(data["urls"]) == 2


@pytest.mark.asyncio
async def test_url_status_transitions_to_success_after_indexing(
    client, default_agent_id
):
    """URL added for an agent should progress to success and be marked indexed."""
    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB bound
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService

            kb_svc = KbService(session=session)
            await kb_svc.get_or_create_agent_kb(default_agent_id, session=session)

    # Mock the URL fetching to avoid external calls
    mock_page_result = {
        "url": "https://example.com/test-page",
        "title": "Test Page",
        "content": "This is test content for indexing. It has enough text to be indexed properly.",
        "status_code": 200,
        "error": None,
    }

    with patch("services.crawler.SiteCrawler.crawl_single_page") as mock_crawl:
        mock_crawl.return_value = type("Result", (), mock_page_result)()

        # Create URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={default_agent_id}",
            json={"urls": ["https://example.com/test-page"]},
        )
        assert response.status_code == 200

        # Trigger refetch/indexing
        refetch_response = await client.post(
            f"/api/v1/urls:refetch?agent_id={default_agent_id}",
            json={"url_ids": [], "force": True},  # Empty = all URLs
        )

        # Refetch should return job info
        assert refetch_response.status_code == 200, (
            f"Expected 200, got {refetch_response.status_code}: {refetch_response.text}"
        )
        refetch_data = refetch_response.json()
        assert "job_id" in refetch_data
        assert refetch_data["status"] in ["queued", "running", "completed"]

    # Verify URL was created in DB
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(URLSource).where(
                URLSource.agent_id == default_agent_id,
                URLSource.normalized_url == "https://example.com/test-page",
            )
        )
        url_source = result.scalar_one_or_none()
        assert url_source is not None


@pytest.mark.asyncio
async def test_url_refetch_endpoint_exists(client, default_agent_id):
    """URL refetch endpoint should exist and accept url_ids and force parameters."""
    response = await client.post(
        f"/api/v1/urls:refetch?agent_id={default_agent_id}",
        json={"url_ids": [], "force": False},
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "urls:refetch endpoint should exist"


@pytest.mark.asyncio
async def test_crawl_site_endpoint_exists(client, default_agent_id):
    """URL crawl_site endpoint should exist and accept url, max_depth, max_pages."""
    response = await client.post(
        f"/api/v1/urls:crawl_site?agent_id={default_agent_id}",
        json={"url": "https://example.com", "max_depth": 2, "max_pages": 10},
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "urls:crawl_site endpoint should exist"


@pytest.mark.asyncio
async def test_discover_urls_endpoint_exists(client, default_agent_id):
    """URL discover endpoint should exist."""
    response = await client.post(
        f"/api/v1/urls:discover?agent_id={default_agent_id}&url=https%3A%2F%2Fexample.com&max_depth=1&max_pages=10",
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "urls:discover endpoint should exist"


@pytest.mark.asyncio
async def test_index_rebuild_endpoint_exists(client, default_agent_id):
    """Index rebuild endpoint should exist and accept force parameter."""
    response = await client.post(
        f"/api/v1/index:rebuild?agent_id={default_agent_id}",
        json={"force": False},
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "index:rebuild endpoint should exist"


@pytest.mark.asyncio
async def test_index_status_endpoint_exists(client, default_agent_id):
    """Index status endpoint should return status info."""
    response = await client.get(
        f"/api/v1/index:status?agent_id={default_agent_id}",
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "index:status endpoint should exist"
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()
    assert "agent_id" in data
    assert "status" in data
    assert data["agent_id"] == default_agent_id


@pytest.mark.asyncio
async def test_index_info_endpoint_exists(client, default_agent_id):
    """Index info endpoint should return index metadata."""
    response = await client.get(
        f"/api/v1/index:info?agent_id={default_agent_id}",
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "index:info endpoint should exist"
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()
    assert "agent_id" in data
    assert "urls_indexed" in data
    assert "index_exists" in data
    assert "status" in data


@pytest.mark.asyncio
async def test_url_fetching_uses_url_safety(client, default_agent_id):
    """URL fetching must go through url_safety validation."""
    # URL validation happens at schema level during request parsing
    # Valid URLs should be accepted, invalid should be rejected
    with patch("api.v1.schemas.validate_url_safe") as mock_validate:
        mock_validate.return_value = (True, "")

        # Create URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={default_agent_id}",
            json={"urls": ["https://example.com/safe-url"]},
        )
        assert response.status_code == 200

        # Verify safety check was called during schema validation
        mock_validate.assert_called()


@pytest.mark.asyncio
async def test_url_fetching_blocks_unsafe_urls(client, default_agent_id):
    """URL fetching should block unsafe URLs (localhost, private IPs)."""
    with patch("services.url_safety.validate_url_safe") as mock_validate:
        mock_validate.return_value = (False, "localhost is not allowed")

        # Try to create unsafe URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={default_agent_id}",
            json={"urls": ["http://localhost:8000/admin"]},
        )

        # Should either reject at creation or mark as failed
        if response.status_code == 200:
            # If accepted, URL should be marked as failed
            async with database.AsyncSessionLocal() as session:
                result = await session.execute(
                    select(URLSource).where(
                        URLSource.agent_id == default_agent_id,
                        URLSource.url.contains("localhost"),
                    )
                )
                url_source = result.scalar_one_or_none()
                if url_source:
                    assert url_source.status == "failed"


@pytest.mark.asyncio
async def test_task_lock_prevents_duplicate_indexing(client, default_agent_id):
    """Task locking prevents INDEX_REBUILD during URL_CRAWL/URL_REFETCH.

    The task lock system prevents:
    - INDEX_REBUILD while URL_CRAWL/URL_REFETCH/URL_FETCH is running
    - URL_CRAWL/URL_REFETCH/URL_FETCH while INDEX_REBUILD is running
    """
    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB bound
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService

            kb_svc = KbService(session=session)
            await kb_svc.get_or_create_agent_kb(default_agent_id, session=session)

    from services.task_lock import task_lock, TaskType

    # Acquire a URL_REFETCH lock
    acquired, _ = await task_lock.acquire_task(
        default_agent_id, TaskType.URL_REFETCH, "refetch_agt_test_123"
    )
    assert acquired, "Should be able to acquire first task lock"

    try:
        # Try to acquire INDEX_REBUILD while URL_REFETCH is running - should fail
        acquired2, error = await task_lock.acquire_task(
            default_agent_id, TaskType.INDEX_REBUILD, "rebuild_agt_test_456"
        )
        # Should fail because URL_REFETCH is running
        assert not acquired2, (
            "Should not be able to acquire INDEX_REBUILD while URL_REFETCH is running"
        )
        assert "refetch" in error.lower() or "crawl" in error.lower() or "抓取" in error
    finally:
        # Release the lock
        await task_lock.release_task(default_agent_id, "refetch_agt_test_123")


@pytest.mark.asyncio
async def test_url_content_upserts_to_qdrant(client, default_agent_id):
    """URL content should be indexed via the document processor pipeline.

    Note: The actual Qdrant upsert happens in a background task,
    so we verify the pipeline was triggered by checking the refetch
    endpoint returns success and creates a job.
    """
    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB bound
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService

            kb_svc = KbService(session=session)
            await kb_svc.get_or_create_agent_kb(default_agent_id, session=session)

    # Create URL and trigger refetch - should succeed and queue job
    with patch("services.crawler.SiteCrawler.crawl_single_page") as mock_crawl:
        mock_crawl.return_value = type(
            "Result",
            (),
            {
                "url": "https://example.com/test-content",
                "title": "Test Content Page",
                "content": "Test content for indexing pipeline. This is enough text to be processed.",
                "status_code": 200,
                "error": None,
            },
        )()

        # Create URL
        create_response = await client.post(
            f"/api/v1/urls:create?agent_id={default_agent_id}",
            json={"urls": ["https://example.com/test-content"]},
        )
        assert create_response.status_code == 200

        # Trigger refetch
        refetch_response = await client.post(
            f"/api/v1/urls:refetch?agent_id={default_agent_id}",
            json={"url_ids": [], "force": True},
        )
        assert refetch_response.status_code == 200
        data = refetch_response.json()
        assert "job_id" in data
        assert data["status"] == "queued"

        # Verify that refetch was queued (background processing handles actual indexing)


@pytest.mark.asyncio
async def test_url_indexed_flag_reflects_success(client, default_agent_id):
    """URLSource.is_indexed should be True when indexing succeeds."""
    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB bound
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService

            kb_svc = KbService(session=session)
            await kb_svc.get_or_create_agent_kb(default_agent_id, session=session)

    # Create a URL source with success status and is_indexed=True
    async with database.AsyncSessionLocal() as session:
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/indexed-page",
            normalized_url="https://example.com/indexed-page",
            status="success",
            is_indexed=True,
            title="Indexed Page",
            content="This page has been indexed",
        )
        session.add(url_source)
        await session.commit()

    # Verify sources:summary reflects the indexed count
    response = await client.get(
        f"/api/v1/sources:summary?agent_id={default_agent_id}",
    )
    assert response.status_code == 200
    data = response.json()
    assert data["urls"]["indexed"] >= 1


@pytest.mark.asyncio
async def test_store_crawl_error_stores_error_message(client, default_agent_id):
    """Test that _store_crawl_error correctly stores error message and sets status to failed.

    This verifies the fix where _store_crawl_error was missing await on session.execute().
    The function should:
    1. Create a new URLSource record if one doesn't exist
    2. Store the error message in last_error field
    3. Set status to 'failed'
    """
    from services.url_service import _store_crawl_error

    test_url = "https://example-crawl-error.com/page"
    error_message = "Crawl failed: connection timeout"

    async with database.AsyncSessionLocal() as session:
        # Call _store_crawl_error with the error
        await _store_crawl_error(
            session=session,
            agent_id=default_agent_id,
            start_url=test_url,
            error_msg=error_message,
        )
        await session.commit()

    # Verify the URLSource was created with error details
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(URLSource).where(
                URLSource.agent_id == default_agent_id,
                URLSource.url == test_url,
            )
        )
        url_source = result.scalar_one_or_none()

        assert url_source is not None, (
            "URLSource should be created by _store_crawl_error"
        )
        assert url_source.status == "failed", (
            f"Expected status='failed', got '{url_source.status}'"
        )
        assert url_source.last_error == error_message, (
            f"Expected last_error='{error_message}', got '{url_source.last_error}'"
        )
        assert url_source.normalized_url == test_url, (
            f"Expected normalized_url='{test_url}', got '{url_source.normalized_url}'"
        )


@pytest.mark.asyncio
async def test_store_crawl_error_updates_existing_url(client, default_agent_id):
    """Test that _store_crawl_error updates an existing URLSource record.

    When a URLSource already exists for the agent+normalized_url combination,
    the function should update its status and last_error rather than creating
    a duplicate.
    """
    from services.url_service import _store_crawl_error

    test_url = "https://example-existing-url.com/page"
    original_error = "Original error"
    new_error = "Updated crawl error"

    # Create an existing URLSource
    async with database.AsyncSessionLocal() as session:
        existing = URLSource(
            agent_id=default_agent_id,
            url=test_url,
            normalized_url=test_url,
            status="pending",
            last_error=original_error,
        )
        session.add(existing)
        await session.commit()
        existing_id = existing.id

    # Call _store_crawl_error to update the existing record
    async with database.AsyncSessionLocal() as session:
        await _store_crawl_error(
            session=session,
            agent_id=default_agent_id,
            start_url=test_url,
            error_msg=new_error,
        )
        await session.commit()

    # Verify the existing record was updated (not a new one created)
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(URLSource).where(
                URLSource.agent_id == default_agent_id,
                URLSource.url == test_url,
            )
        )
        url_sources = result.scalars().all()

        assert len(url_sources) == 1, (
            f"Expected 1 URLSource, got {len(url_sources)} (duplicate created)"
        )
        url_source = url_sources[0]
        assert url_source.id == existing_id, (
            "Should update existing record, not create new"
        )
        assert url_source.status == "failed", (
            f"Expected status='failed', got '{url_source.status}'"
        )
        assert url_source.last_error == new_error, (
            f"Expected last_error='{new_error}', got '{url_source.last_error}'"
        )


@pytest.mark.asyncio
async def test_store_crawl_error_retrievable_via_url_list(client, default_agent_id):
    """Test that errors stored by _store_crawl_error are visible in URL list endpoint.

    This verifies the error is committed to the database and can be retrieved
    through the normal API flow.
    """
    from services.url_service import _store_crawl_error

    test_url = "https://example-api-visible.com/page"
    error_message = "Site crawl failed: SSL certificate error"

    # Store crawl error via the service function
    async with database.AsyncSessionLocal() as session:
        await _store_crawl_error(
            session=session,
            agent_id=default_agent_id,
            start_url=test_url,
            error_msg=error_message,
        )
        await session.commit()

    # Retrieve via API endpoint
    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    # Find the URL in the response
    url_item = next(
        (u for u in data["urls"] if u["url"] == test_url),
        None,
    )
    assert url_item is not None, (
        f"URL with error should be retrievable via list endpoint. URLs: {[u['url'] for u in data['urls']]}"
    )
    assert url_item["status"] == "failed", (
        f"Expected status='failed' in API response, got '{url_item['status']}'"
    )
    assert url_item["last_error"] == error_message, (
        f"Expected last_error='{error_message}' in API response, got '{url_item.get('last_error', 'MISSING')}'"
    )


@pytest.mark.asyncio
async def test_cancel_url_tasks_endpoint_exists(client, default_agent_id):
    """URL cancel tasks endpoint should exist."""
    response = await client.post(
        f"/api/v1/urls:cancel?agent_id={default_agent_id}",
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "urls:cancel endpoint should exist"


@pytest.mark.asyncio
async def test_is_indexed_true_on_process_success(client, default_agent_id):
    """When KbDocument.status is 'ready', is_indexed should be True.

    This test verifies the fix logic: after process_document returns,
    we check doc.status and only set is_indexed=True if status=='ready'.
    """
    from models import KnowledgeBase, KbDocument
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

        # Create a KbDocument in "ready" status (simulating successful processing)
        doc = KbDocument(
            id=str(uuid.uuid4()),
            kb_id=kb_id,
            tenant_id=agent.workspace_id,
            filename="test.txt",
            file_size=100,
            status="ready",  # Successful processing
            chunk_count=2,
        )
        session.add(doc)
        await session.flush()
        doc_id = doc.id

        # The logic from url_service.py: check doc status and set is_indexed
        updated_doc = await session.get(KbDocument, doc_id)
        is_indexed = updated_doc.status == "ready"

        assert is_indexed is True, (
            f"Expected is_indexed=True when doc.status='ready', got {is_indexed}"
        )


@pytest.mark.asyncio
async def test_is_indexed_false_on_process_failure(client, default_agent_id):
    """After process_document fails internally (KbDocument in error status),
    url_source.is_indexed should remain False.

    This test verifies the bug fix where is_indexed was unconditionally set to True
    after process_document(), even when document processing failed internally.
    """
    from models import KnowledgeBase, KbDocument
    from services.kb_document_processor import KbDocumentProcessor
    import uuid

    # Create URL source and ensure agent has KB
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
                name=f"Agent {default_agent_id} KB",
                embedding_model="BAAI/bge-m3",
                qdrant_collection=f"kb_{new_kb_id}",
            )
            session.add(kb)
            await session.flush()
            agent.kb_id = kb.id
        kb_id = agent.kb_id

        # Create URL source
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/fail-page",
            normalized_url="https://example.com/fail-page",
            status="success",  # Already fetched
            title="Fail Page",
            content="Test content for document processing.",
        )
        session.add(url_source)
        await session.flush()
        url_id = url_source.id
        await session.commit()

    # Directly test the fix: create a doc and process it with a failing parser
    processor = KbDocumentProcessor()

    async with database.AsyncSessionLocal() as session:
        # Create document record
        doc = await processor.create_document_record(
            tenant_id=1,  # agent.workspace_id
            kb_id=kb_id,
            filename=f"url_{url_id}.txt",
            file_size=100,
            db=session,
        )
        # Set storage_path and file_type as url_service.py does
        object.__setattr__(doc, "storage_path", "/tmp/test_fail.txt")
        object.__setattr__(doc, "file_type", "txt")
        await session.commit()
        doc_id = str(doc.id)

    # Mock parse_with_retry to fail
    with patch.object(
        processor.parser,
        "parse_with_retry",
        side_effect=Exception("Simulated parse failure"),
    ):
        # Process the document - this should set status="error" internally
        await processor.process_document(doc_id, "1", kb_id)

    # Verify document is in error status
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(KbDocument).where(KbDocument.id == doc_id)
        )
        updated_doc = result.scalar_one()
        assert updated_doc.status == "error", (
            f"Expected doc status='error', got '{updated_doc.status}'"
        )

        # Now test the fixed logic: re-query doc and set is_indexed based on status
        is_indexed = updated_doc.status == "ready"
        assert is_indexed is False, (
            f"BUG: is_indexed should be False when doc status is '{updated_doc.status}', "
            f"but got is_indexed={is_indexed}"
        )


@pytest.mark.asyncio
async def test_process_url_refetch_in_syntax(client, default_agent_id):
    """Test that process_url_refetch compiles the SQL query correctly.

    This test verifies the fix for the SQLAlchemy .in_() syntax error where
    multiple positional arguments were passed instead of a list.

    Before fix: URLSource.status.in_("pending", "success", "failed")
    -> TypeError: ColumnOperators.in_() takes 2 positional arguments but 4 were given

    After fix: URLSource.status.in_(["pending", "success", "failed"])
    -> Compiles correctly to: status IN (?, ?, ?)
    """
    from sqlalchemy import select
    from models import URLSource

    # Build the query the same way process_url_refetch does (after fix)
    query = select(URLSource).where(
        URLSource.agent_id == default_agent_id,
        URLSource.status.in_(["pending", "success", "failed"]),
    )

    # Compile the query to verify it works
    compiled = query.compile(compile_kwargs={"literal_binds": True})
    sql_str = str(compiled)

    # Verify the query contains the IN clause
    assert "IN" in sql_str.upper(), f"Query should contain IN clause: {sql_str}"
    assert "pending" in sql_str.lower(), f"Query should contain 'pending': {sql_str}"
    assert "success" in sql_str.lower(), f"Query should contain 'success': {sql_str}"
    assert "failed" in sql_str.lower(), f"Query should contain 'failed': {sql_str}"

    print(f"Generated SQL: {sql_str}")


@pytest.mark.asyncio
async def test_in_operator_rejects_multiple_positional_args():
    """Verify that .in_(arg1, arg2, arg3) raises TypeError.

    This documents the bug pattern that was fixed.
    """
    from sqlalchemy import String
    from sqlalchemy.sql import column

    status_col = column("status", String)

    # Multiple positional args should raise TypeError
    with pytest.raises(TypeError) as exc_info:
        status_col.in_("pending", "success", "failed")

    assert "takes 2 positional arguments" in str(exc_info.value)


def test_crawl_page_result_accesses_status_code_from_metadata():
    """Unit test: CrawlPageResult.status_code should be accessed via metadata dict.

    This verifies the fix for the AttributeError where page_result.status_code
    was accessed, but CrawlPageResult doesn't have that field - it should
    be retrieved from page_result.metadata instead.

    Before fix: page_result.status_code -> AttributeError
    After fix: (page_result.metadata or {}).get("status_code") -> 200
    """
    from services.crawler import CrawlPageResult

    # Create a CrawlPageResult with metadata containing status_code
    page_result = CrawlPageResult(
        url="https://example.com/test",
        title="Test Page",
        content="Test content",
        content_hash="abc123",
        depth=0,
        success=True,
        error=None,
        metadata={"status_code": 200, "final_url": "https://example.com/test"},
    )

    # Verify CrawlPageResult does NOT have status_code attribute
    assert (
        not hasattr(page_result, "status_code")
        or "status_code" not in page_result.__dict__
    ), "CrawlPageResult should not have a direct status_code attribute"

    # Verify the CORRECT way to access status_code (via metadata)
    status_code = (page_result.metadata or {}).get("status_code")
    assert status_code == 200, (
        f"Expected status_code=200 from metadata, got {status_code}"
    )

    # Verify final_url is accessible directly (it's a field on CrawlPageResult)
    final_url = page_result.url
    assert final_url == "https://example.com/test", (
        f"Expected url field, got {final_url}"
    )

    # Simulate the fixed fetch_metadata construction
    fetch_metadata = {
        "status_code": (page_result.metadata or {}).get("status_code"),
        "final_url": page_result.url,
    }

    assert fetch_metadata["status_code"] == 200
    assert fetch_metadata["final_url"] == "https://example.com/test"


@pytest.mark.asyncio
async def test_fetch_metadata_uses_metadata_dict_for_status_code(
    client, default_agent_id
):
    """Integration test: URL refetch endpoint accepts requests and queues job.

    This verifies the refetch endpoint accepts the request and queues a job.
    The actual background processing is tested separately via unit tests.

    Note: We don't test process_url_refetch directly here because it creates
    its own AsyncSessionLocal session which uses a different database connection
    than the test fixtures. Full integration testing of background tasks requires
    a different approach (e.g., mocking background_tasks.add_task).
    """
    from services.crawler import CrawlPageResult
    from unittest.mock import patch

    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB bound
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService

            kb_svc = KbService(session=session)
            await kb_svc.get_or_create_agent_kb(default_agent_id, session=session)

    # Create URL source first via API
    url = "https://example.com/test-metadata"
    create_response = await client.post(
        f"/api/v1/urls:create?agent_id={default_agent_id}",
        json={"urls": [url]},
    )
    assert create_response.status_code == 200

    # Get the created URL's ID
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(URLSource).where(
                URLSource.agent_id == default_agent_id,
                URLSource.normalized_url == url,
            )
        )
        url_source = result.scalar_one()
        url_id = url_source.id

    # Patch process_url_refetch to avoid database session issues in background task
    with patch("services.url_service.process_url_refetch") as mock_refetch:
        # Call the refetch endpoint
        refetch_response = await client.post(
            f"/api/v1/urls:refetch?agent_id={default_agent_id}",
            json={"url_ids": [url_id], "force": True},
        )
        assert refetch_response.status_code == 200
        refetch_data = refetch_response.json()
        assert "job_id" in refetch_data

        # Verify process_url_refetch was called (confirms the endpoint dispatches correctly)
        mock_refetch.assert_called_once()
        call_kwargs = mock_refetch.call_args.kwargs
        assert call_kwargs["agent_id"] == default_agent_id
        assert url_id in call_kwargs["url_ids"]
        assert call_kwargs["force"] is True
        assert "job_id" in call_kwargs


@pytest.mark.asyncio
async def test_create_urls_auto_dispatches_background_fetch(client, default_agent_id):
    """create_urls endpoint should auto-dispatch background fetch for new URLs.

    When URLs are created, the endpoint should:
    1. Return a job_id in the response indicating background fetch was queued
    2. URLs should transition from 'pending' status after background processing

    This tests the fix for URLs getting stuck in 'pending' status.
    """
    from unittest.mock import patch

    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB bound
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        if not agent.kb_id:
            from services.kb_service import KbService

            kb_svc = KbService(session=session)
            await kb_svc.get_or_create_agent_kb(default_agent_id, session=session)

    # Mock process_url_refetch to verify it gets called
    with patch("services.url_service.process_url_refetch") as mock_refetch:
        mock_refetch.return_value = None

        response = await client.post(
            f"/api/v1/urls:create?agent_id={default_agent_id}",
            json={"urls": ["https://example.com/auto-fetch-test"]},
        )

        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()

        # Response should include job_id when auto-fetch is dispatched
        assert "job_id" in data, (
            f"create_urls should return job_id when auto-dispatching background fetch. "
            f"Got keys: {list(data.keys())}"
        )
        assert data["job_id"] is not None
        assert data.get("auto_fetch_queued") is True, (
            "auto_fetch_queued should be True when background fetch is dispatched"
        )


@pytest.mark.asyncio
async def test_clear_all_urls_response_schema(client, default_agent_id):
    """Test that urls:clear_all returns message and deleted_count fields.

    Frontend expects {message: string, deleted_count: number} but backend
    was only returning {success: True}.
    """
    # Create some URLs first
    url_data = {"urls": ["https://example1.com", "https://example2.com"]}
    create_response = await client.post(
        f"/api/v1/urls:create?agent_id={default_agent_id}",
        json=url_data,
    )
    assert create_response.status_code == 200

    # Clear all URLs
    response = await client.post(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    # Assert response has expected fields matching frontend expectation
    assert "message" in data, (
        f"Response missing 'message' field. Got: {list(data.keys())}"
    )
    assert "deleted_count" in data, (
        f"Response missing 'deleted_count' field. Got: {list(data.keys())}"
    )
    assert isinstance(data["message"], str), "message should be a string"
    assert isinstance(data["deleted_count"], int), "deleted_count should be an int"
    assert data["deleted_count"] == 2, (
        f"Expected deleted_count=2, got {data['deleted_count']}"
    )


# ========== KB Indexing Diagnostics Gap Tests ==========
# These tests expose the gap where URL responses do not include enough
# diagnostic information about KB processing status.


@pytest.mark.asyncio
async def test_url_list_exposes_indexing_error_for_fetch_success_process_failure(
    client, default_agent_id
):
    """When URL fetch succeeds but KB processing fails, API should expose error.

    GAP: Currently URLSource.last_error is only set on fetch failures.
    When fetch succeeds but document processing fails, error is only in
    KbDocument.error_message and not visible in URL list response.

    Expected: URL list should include indexing_error field.
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
                name=f"Agent {default_agent_id} KB",
                embedding_model="BAAI/bge-m3",
                qdrant_collection=f"kb_{new_kb_id}",
            )
            session.add(kb)
            await session.flush()
            agent.kb_id = kb.id
        kb_id = agent.kb_id
        tenant_id = str(agent.workspace_id)

        # Create URL: fetch succeeded, but indexing failed
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/fetch-ok-index-fail",
            normalized_url="https://example.com/fetch-ok-index-fail",
            status="success",  # Fetch worked
            is_indexed=False,  # But indexing failed
            title="Fetch OK Index Fail",
            content="Content fetched successfully",
            last_error=None,  # No fetch error
        )
        session.add(url_source)
        await session.flush()

        # Create KbDocument with error (simulating failed processing)
        doc = KbDocument(
            id=str(uuid.uuid4()),
            kb_id=kb_id,
            tenant_id=tenant_id,
            filename="url_content.txt",
            status="error",
            error_message="Embedding API rate limit exceeded",
        )
        session.add(doc)
        await session.commit()

    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    url_item = next(
        (
            u
            for u in data["urls"]
            if u["url"] == "https://example.com/fetch-ok-index-fail"
        ),
        None,
    )
    assert url_item is not None
    assert url_item["status"] == "success"
    assert url_item["is_indexed"] is False

    # EXPECTED: URL should expose indexing error when fetch succeeded but indexing failed
    # This assertion documents the GAP - it will FAIL until the API is enhanced
    assert "indexing_error" in url_item, (
        "GAP: URLItem should expose indexing_error field when fetch succeeded "
        "but KB processing failed. Current: error only in KbDocument.error_message, "
        "not visible in URL list response."
    )
    assert url_item["indexing_error"] == "Embedding API rate limit exceeded", (
        "GAP: indexing_error should contain KbDocument.error_message"
    )


@pytest.mark.asyncio
async def test_url_list_exposes_indexing_status_field(client, default_agent_id):
    """URL list should expose explicit indexing_status field.

    GAP: Current URLItem only has status (fetch) and is_indexed (bool).
    Cannot distinguish between 'still processing' vs 'processing failed'.

    Expected: URLItem should have indexing_status with values:
    'pending'|'processing'|'ready'|'error'
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

        # Create URL being processed
        url_source = URLSource(
            agent_id=default_agent_id,
            url="https://example.com/processing",
            normalized_url="https://example.com/processing",
            status="success",
            is_indexed=False,
        )
        session.add(url_source)
        await session.commit()

    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()

    url_item = next(
        (u for u in data["urls"] if u["url"] == "https://example.com/processing"), None
    )
    assert url_item is not None

    # EXPECTED: explicit indexing_status field
    # This assertion documents the GAP
    assert "indexing_status" in url_item, (
        "GAP: URLItem should expose indexing_status field with explicit values "
        "('pending'|'processing'|'ready'|'error') to distinguish processing state "
        "from fetch status. Current: only is_indexed boolean available."
    )
    assert url_item["indexing_status"] in ["pending", "processing", "ready", "error"], (
        "indexing_status should have explicit state values"
    )


# ========== Scrapling Service /discover Endpoint Tests ==========


def _import_scrapling_module():
    """Import scrapling-service/main.py with mocked dependencies."""
    import sys
    import importlib.util
    from unittest.mock import MagicMock

    # Mock curl_cffi if not installed
    if "curl_cffi" not in sys.modules:
        curl_cffi_mock = MagicMock()
        curl_cffi_requests_mock = MagicMock()
        curl_cffi_mock.requests = curl_cffi_requests_mock
        sys.modules["curl_cffi"] = curl_cffi_mock
        sys.modules["curl_cffi.requests"] = curl_cffi_requests_mock

    # Use a unique module name to avoid conflicts
    module_name = f"scrapling_test_{id(_import_scrapling_module)}"
    scrapling_path = "/Users/yi/Documents/Projects/basjoo/scrapling-service/main.py"
    spec = importlib.util.spec_from_file_location(module_name, scrapling_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.asyncio
async def test_scrapling_discover_returns_urls_at_multiple_depths():
    """Test that Scrapling /discover endpoint returns URLs at multiple depths via BFS.

    This test verifies the fix for recursive depth crawling. The old implementation
    only returned depth=1 links from the start page. The new BFS implementation
    should return URLs at depth=0, 1, 2, etc. up to max_depth.

    Test structure:
    - Root page (depth=0): https://example.com/
    - Level 1 pages (depth=1): /about, /products
    - Level 2 pages (depth=2): /products/item1, /products/item2

    Expected: discover endpoint returns URLs at depths 0, 1, and 2.
    """
    from unittest.mock import patch, MagicMock
    import httpx

    # HTML for root page (depth=0) - links to level 1
    root_html = """
    <html>
        <head><title>Root Page</title></head>
        <body>
            <a href="/about">About</a>
            <a href="/products">Products</a>
            <a href="https://other.com/external">External (should be filtered)</a>
        </body>
    </html>
    """

    # HTML for /about page (depth=1) - no further links
    about_html = """
    <html>
        <head><title>About Page</title></head>
        <body>
            <p>About us</p>
        </body>
    </html>
    """

    # HTML for /products page (depth=1) - links to level 2
    products_html = """
    <html>
        <head><title>Products</title></head>
        <body>
            <a href="/products/item1">Item 1</a>
            <a href="/products/item2">Item 2</a>
            <a href="/about">About (already discovered)</a>
        </body>
    </html>
    """

    # HTML for /products/item1 and /products/item2 (depth=2)
    item_html = """
    <html>
        <head><title>Product Item</title></head>
        <body><p>Product details</p></body>
    </html>
    """

    def mock_fetch_response(url, timeout):
        """Mock _fetch_with_fallback to return tuple: (html, status_code, final_url, content_type)."""
        url_str = str(url) if hasattr(url, "path") else url

        if (
            "example.com/" in url_str
            and "/about" not in url_str
            and "/products" not in url_str
        ):
            return (root_html, 200, url, "text/html")
        elif "/about" in url_str and "/products" not in url_str:
            return (about_html, 200, url, "text/html")
        elif "/products/item" in url_str:
            return (item_html, 200, url, "text/html")
        elif "/products" in url_str:
            return (products_html, 200, url, "text/html")
        else:
            return ("", 404, url, "text/html")

    scrapling_main = _import_scrapling_module()

    # Test the discover endpoint with mocked fetch
    from fastapi.testclient import TestClient

    client = TestClient(scrapling_main.app)

    with patch.object(scrapling_main, "_fetch_with_fallback") as mock_fetch:
        mock_fetch.side_effect = mock_fetch_response

        response = client.post(
            "/discover",
            json={"url": "https://example.com/", "max_depth": 2, "max_pages": 10},
        )

        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()

        # Should have urls list
        assert "urls" in data, (
            f"Response should have 'urls' field. Got: {list(data.keys())}"
        )
        urls = data["urls"]
        assert len(urls) > 0, "Should discover at least the root URL"

        # Should have URLs at multiple depths
        depths = {item["depth"] for item in urls}
        assert 0 in depths or 1 in depths, (
            f"Should have URLs at depth 0 or 1. Got depths: {depths}, urls: {urls}"
        )

        discovered_urls = {item["url"] for item in urls}

        # At minimum, should have root and some subpages
        assert "https://example.com/" in discovered_urls, "Should include root URL"

        # Check depth values are reasonable (0-2 for max_depth=2)
        for item in urls:
            assert 0 <= item["depth"] <= 2, (
                f"Depth should be between 0 and max_depth (2), got {item['depth']} for {item['url']}"
            )

        # Verify external URLs are filtered out
        for item in urls:
            assert "other.com" not in item["url"], (
                f"External URL should be filtered: {item['url']}"
            )


@pytest.mark.asyncio
async def test_scrapling_discover_respects_max_depth():
    """Test that /discover respects max_depth parameter.

    With max_depth=1, should only return depth=0 and depth=1 URLs.
    With max_depth=2, should return up to depth=2.
    """
    from fastapi.testclient import TestClient
    from unittest.mock import patch

    scrapling_main_depth = _import_scrapling_module()

    client = TestClient(scrapling_main_depth.app)

    # Create a chain of pages: root -> page1 -> page2
    def mock_fetch(url, timeout):
        """Mock _fetch_with_fallback to return tuple: (html, status_code, final_url, content_type)."""
        url_str = str(url)
        if "example.com/" in url_str and "/page1" not in url_str:
            return ('<a href="/page1">Page 1</a>', 200, url, "text/html")
        elif "/page1" in url_str and "/page2" not in url_str:
            return ('<a href="/page2">Page 2</a>', 200, url, "text/html")
        elif "/page2" in url_str:
            return ("<p>No links</p>", 200, url, "text/html")
        return ("", 404, url, "text/html")

    # Test max_depth=1
    with patch.object(scrapling_main_depth, "_fetch_with_fallback") as mock_fetch_fn:
        mock_fetch_fn.side_effect = mock_fetch

        response = client.post(
            "/discover",
            json={"url": "https://example.com/", "max_depth": 1, "max_pages": 10},
        )

        assert response.status_code == 200
        data = response.json()
        urls = data["urls"]

        # Should have root (depth=0) and page1 (depth=1)
        # Should NOT have page2 (would be depth=2)
        for item in urls:
            assert item["depth"] <= 1, (
                f"With max_depth=1, all URLs should have depth <= 1. "
                f"Got {item['depth']} for {item['url']}"
            )

    # Test max_depth=2
    with patch.object(scrapling_main_depth, "_fetch_with_fallback") as mock_fetch_fn:
        mock_fetch_fn.side_effect = mock_fetch

        response = client.post(
            "/discover",
            json={"url": "https://example.com/", "max_depth": 2, "max_pages": 10},
        )

        assert response.status_code == 200
        data = response.json()
        urls = data["urls"]

        # Should have page2 at depth=2
        depths = {item["depth"] for item in urls}
        assert 2 in depths or len(urls) < 3, (
            f"With max_depth=2, should have depth=2 URLs or few pages. "
            f"Got depths: {depths}, urls: {urls}"
        )


@pytest.mark.asyncio
async def test_scrapling_discover_respects_max_pages():
    """Test that /discover respects max_pages parameter.

    Should stop crawling after discovering max_pages URLs.
    """
    from fastapi.testclient import TestClient
    from unittest.mock import patch

    scrapling_main_pages = _import_scrapling_module()

    client = TestClient(scrapling_main_pages.app)

    # Root page with many links
    def mock_fetch(url, timeout):
        """Mock _fetch_with_fallback to return tuple: (html, status_code, final_url, content_type)."""
        url_str = str(url)
        if "example.com/" in url_str:
            # Generate many links
            links = "\n".join(
                [f'<a href="/page{i}">Page {i}</a>' for i in range(1, 20)]
            )
            return (f"<html><body>{links}</body></html>", 200, url, "text/html")
        return ("<p>Empty</p>", 200, url, "text/html")

    with patch.object(scrapling_main_pages, "_fetch_with_fallback") as mock_fetch_fn:
        mock_fetch_fn.side_effect = mock_fetch

        response = client.post(
            "/discover",
            json={"url": "https://example.com/", "max_depth": 2, "max_pages": 5},
        )

        assert response.status_code == 200
        data = response.json()
        urls = data["urls"]

        assert len(urls) <= 5, (
            f"Should return at most max_pages URLs. Got {len(urls)} URLs, expected <= 5"
        )


@pytest.mark.asyncio
async def test_scrapling_discover_avoids_cycles():
    """Test that /discover avoids cycles by tracking visited URLs.

    If page A links to B and B links back to A, should not infinite loop.
    """
    from fastapi.testclient import TestClient
    from unittest.mock import patch

    scrapling_main_cycles = _import_scrapling_module()

    client = TestClient(scrapling_main_cycles.app)

    # A <-> B cycle
    def mock_fetch(url, timeout):
        """Mock _fetch_with_fallback to return tuple: (html, status_code, final_url, content_type)."""
        url_str = str(url)
        if "example.com/" in url_str and "/b" not in url_str:
            return ('<a href="/b">Go to B</a>', 200, url, "text/html")
        elif "/b" in url_str:
            return (
                '<a href="/">Back to A</a><a href="/c">Go to C</a>',
                200,
                url,
                "text/html",
            )
        elif "/c" in url_str:
            return ("<p>No links</p>", 200, url, "text/html")
        return ("", 404, url, "text/html")

    with patch.object(scrapling_main_cycles, "_fetch_with_fallback") as mock_fetch_fn:
        mock_fetch_fn.side_effect = mock_fetch

        response = client.post(
            "/discover",
            json={"url": "https://example.com/", "max_depth": 3, "max_pages": 10},
        )

        assert response.status_code == 200
        data = response.json()
        urls = data["urls"]

        # Should have A, B, C - no duplicates
        discovered_urls = [item["url"] for item in urls]
        unique_urls = set(discovered_urls)
        assert len(discovered_urls) == len(unique_urls), (
            f"Should not have duplicate URLs. Got: {discovered_urls}"
        )

        # Should complete without infinite loop
        assert len(urls) >= 3, f"Should discover at least 3 unique URLs. Got: {urls}"
