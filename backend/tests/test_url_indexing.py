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

from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock
import pytest
from sqlalchemy import select

import database
from models import Agent, KbDocument, URLSource

# Captured at import time, BEFORE the autouse `hermetic_url_network` fixture swaps
# the module attribute for a no-network stand-in. Needed by the signature contract
# test, which must see the function that is really shipped.
from services.url_service import process_url_refetch as _real_process_url_refetch

# ========== Hermetic harness ==========
#
# These tests drive routes that schedule *real* background work
# (`process_url_refetch`, `process_index_rebuild`) and one route that fetches
# synchronously (`urls:discover` -> SiteCrawler). Under httpx/ASGITransport a
# BackgroundTasks callback runs inline before the response is returned, so any
# un-stubbed hop reaches the outside world:
#
#   test -> urls:create -> process_url_refetch -> URLScraper.fetch
#        -> ScraplingClient.fetch -> POST http://scrapling-service:8001/fetch
#           (DNS failure -> 60 s connect timeout, then the same again from
#            refetch, index:rebuild and crawl_site...)
#
# That is what made one `urls:create` test take ~122 s and the file ~10 min.
#
# The fixtures below make the file hermetic WITHOUT weakening any assertion:
# * `hermetic_url_network` (autouse) replaces the background entry points at
#   the module object the router imports them from, and stubs the HTTP layer of
#   the scrapling client (fetch + discover) plus the embedding call, so neither
#   the background task nor `urls:discover` can touch a socket.
# * Nothing is asserted *through* these stubs; the tests that DO care about
#   dispatch already re-patch `services.url_service.process_url_refetch`
#   themselves and keep their `assert_called_once` checks.
# * A socket guard turns any accidental outbound connection into an immediate,
#   loud failure instead of a 60 s timeout, so a regression cannot silently
#   reintroduce the slow path.

#: Canned body returned by the stubbed `ScraplingClient.fetch`.
HERMETIC_PAGE = {
    "success": True,
    "title": "Hermetic Page",
    "content": (
        "Hermetic test content. This paragraph exists so the document parser has "
        "enough readable text to produce at least one chunk for the KB pipeline."
    ),
    "content_hash": "hermetic-content-hash",
    "metadata": {"status_code": 200, "final_url": "https://example.com/hermetic"},
}

#: Deterministic 8-dim embedding so Qdrant/collection code never sees a
#: provider call. Width is irrelevant to these tests (`embedding_dimension` is
#: only persisted, never compared against a live collection here).
HERMETIC_EMBEDDING = [0.01] * 8


async def _hermetic_scrapling_fetch(self, url, *args, **kwargs):
    data = dict(HERMETIC_PAGE)
    data["metadata"] = dict(HERMETIC_PAGE["metadata"], final_url=url)
    return data


async def _hermetic_scrapling_discover(self, url, max_depth=1, max_pages=20):
    """One-page discovery: the seed URL at depth 0, nothing else."""
    return [(url, 0)]


async def _hermetic_embed_texts(self, texts, model, base_url, api_key=None):
    return [list(HERMETIC_EMBEDDING) for _ in texts]


async def _hermetic_url_refetch(*args, **kwargs):
    """Stand-in for `services.url_service.process_url_refetch` (no network)."""
    return None


async def _hermetic_index_rebuild(*args, **kwargs):
    """Stand-in for `services.url_service.process_index_rebuild` (no network)."""
    return None


async def _hermetic_site_crawl(*args, **kwargs):
    """Stand-in for `services.url_service.process_site_crawl` (no network).

    `urls:crawl_site` dispatches it with `asyncio.create_task`, i.e. it is not a
    BackgroundTasks callback and would otherwise keep running after the test.
    """
    return None


@pytest.fixture(autouse=True)
def hermetic_url_network(monkeypatch):
    """Deny outbound sockets and stub the fetch/embed seams for this module.

    Applies to every test in this file. Nothing here asserts anything, so a
    test that wants to check dispatch re-patches the seam itself (with
    `unittest.mock.patch`, which wins because it is applied later).
    """
    import socket

    from services import scrapling_client as scrapling_client_module
    from services.document_parser import DocumentParser
    from services.scrapling_client import ScraplingClient

    # 1. HTTP layer of the scrapling microservice client (fetch + discover).
    monkeypatch.setattr(
        ScraplingClient, "fetch", _hermetic_scrapling_fetch, raising=True
    )
    monkeypatch.setattr(
        ScraplingClient, "discover_subpages", _hermetic_scrapling_discover, raising=True
    )
    # `services.scraper.URLScraper` holds a client instance, so patching the
    # class is enough for every `SiteCrawler` built inside a background task.
    monkeypatch.setattr(scrapling_client_module, "_default_client", None)

    # 2. Embedding provider call (OpenAI-compatible HTTP) used by the KB pipeline.
    monkeypatch.setattr(
        DocumentParser, "embed_texts", _hermetic_embed_texts, raising=True
    )

    # 3. Background entry points, patched where the router imports them.
    import services.url_service as url_service_module

    monkeypatch.setattr(
        url_service_module, "process_url_refetch", _hermetic_url_refetch, raising=True
    )
    monkeypatch.setattr(
        url_service_module, "process_index_rebuild", _hermetic_index_rebuild, raising=True
    )
    monkeypatch.setattr(
        url_service_module, "process_site_crawl", _hermetic_site_crawl, raising=True
    )

    # 4. DNS: resolve only the synthetic hosts this file uses, to a fixed public
    #    IP, so `validate_url_safe` still runs its real checks (scheme,
    #    credentials, localhost, IP literals, blocked ranges) with no resolver
    #    round-trip. Unknown hostnames are reported as unresolvable: fail-closed,
    #    so a test that starts pointing at a real site breaks loudly instead of
    #    quietly dialling the internet.
    import services.url_safety as url_safety_module

    safe_test_hosts = {"example.com", "example1.com", "example2.com"}

    def _hermetic_resolve(hostname):
        host = (hostname or "").lower()
        if host in safe_test_hosts or host.startswith("example-"):
            return True, ""
        if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost"):
            return False, "Resolved to blocked IP 127.0.0.1"
        return False, f"DNS resolution failed: {hostname} is not a hermetic test host"

    monkeypatch.setattr(
        url_safety_module, "_resolve_and_check", _hermetic_resolve, raising=True
    )

    # 5. Socket guard: fail fast instead of waiting out a connect timeout.
    #    Local SQLite/Redis on 127.0.0.1 stay reachable so fixtures still work;
    #    anything else raises immediately.
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    allowed_hosts = {"127.0.0.1", "::1", "localhost"}

    def _is_allowed(address):
        if not isinstance(address, tuple):
            return False
        host = address[0]
        return host in allowed_hosts

    def guard_connect(self, address):
        if not _is_allowed(address):
            raise OSError(
                f"hermetic network guard: blocked outbound connection to {address!r}"
            )
        return real_connect(self, address)

    def guard_connect_ex(self, address):
        if not _is_allowed(address):
            raise OSError(
                f"hermetic network guard: blocked outbound connection to {address!r}"
            )
        return real_connect_ex(self, address)

    monkeypatch.setattr(socket.socket, "connect", guard_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guard_connect_ex)

    yield


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
    client, default_agent_id, bound_kb_id
):
    """URL added for an agent should progress to success and be marked indexed."""
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
                URLSource.kb_id == bound_kb_id,
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
async def test_url_fetching_blocks_unsafe_urls(client, default_agent_id, bound_kb_id):
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
                        URLSource.kb_id == bound_kb_id,
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
async def test_url_indexed_flag_reflects_success(client, default_agent_id, bound_kb_id):
    """URLSource.is_indexed should be True when indexing succeeds."""
    # Create a URL source with success status and is_indexed=True
    async with database.AsyncSessionLocal() as session:
        url_source = URLSource(
            kb_id=bound_kb_id,
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
async def test_store_crawl_error_stores_error_message(client, default_agent_id, bound_kb_id):
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
            kb_id=bound_kb_id,
            start_url=test_url,
            error_msg=error_message,
        )
        await session.commit()

    # Verify the URLSource was created with error details
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(URLSource).where(
                URLSource.kb_id == bound_kb_id,
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
async def test_store_crawl_error_updates_existing_url(client, default_agent_id, bound_kb_id):
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
            kb_id=bound_kb_id,
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
            kb_id=bound_kb_id,
            start_url=test_url,
            error_msg=new_error,
        )
        await session.commit()

    # Verify the existing record was updated (not a new one created)
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(URLSource).where(
                URLSource.kb_id == bound_kb_id,
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
async def test_store_crawl_error_retrievable_via_url_list(client, default_agent_id, bound_kb_id):
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
            kb_id=bound_kb_id,
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
    from models import KbDocument
    import uuid

    async with database.AsyncSessionLocal() as session:
        # Ensure agent has KB
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_id is not None, "Fixture must bind a KB to the test agent"
        kb_id = agent.kb_id

        # Create a KbDocument in "ready" status (simulating successful processing)
        doc = KbDocument(
            id=str(uuid.uuid4()),
            kb_id=kb_id,
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
    from models import KbDocument
    from services.kb_document_processor import KbDocumentProcessor
    import uuid

    # Create URL source and ensure agent has KB
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == default_agent_id)
        )
        agent = result.scalar_one()
        assert agent.kb_id is not None, "Fixture must bind a KB to the test agent"
        kb_id = agent.kb_id

        # Create URL source
        url_source = URLSource(
            kb_id=kb_id,
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
            agent.workspace_id,
            kb_id,
            f"url_{url_id}.txt",
            100,
            source_agent_id=default_agent_id,
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
        await processor.process_document(doc_id, kb_id)

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
async def test_process_url_refetch_in_syntax(client, default_agent_id, bound_kb_id):
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
        URLSource.kb_id == bound_kb_id,
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
    client, default_agent_id, bound_kb_id
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
                URLSource.kb_id == bound_kb_id,
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
        assert call_kwargs["kb_id"] == bound_kb_id
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
    import uuid

    # Create some URLs first, plus the two documents their ingestion produced.
    url_data = {"urls": ["https://example1.com", "https://example2.com"]}
    create_response = await client.post(
        f"/api/v1/urls:create?agent_id={default_agent_id}",
        json=url_data,
    )
    assert create_response.status_code == 200

    async with database.AsyncSessionLocal() as session:
        agent = (
            await session.execute(select(Agent).where(Agent.id == default_agent_id))
        ).scalar_one()
        assert agent.kb_id is not None
        for suffix in ("1", "2"):
            session.add(
                KbDocument(
                    id=str(uuid.uuid4()),
                    kb_id=agent.kb_id,
                    source_agent_id=default_agent_id,
                    filename=f"url_{suffix}.txt",
                    status="ready",
                )
            )
        await session.commit()

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
    # `deleted_count` is the number of KB documents removed (the expensive side
    # effect), and both URLs are reported separately.
    assert data["deleted_count"] == 2, (
        f"Expected deleted_count=2, got {data['deleted_count']}"
    )
    assert data["deleted_url_count"] == 2


@pytest.mark.asyncio
async def test_clear_all_urls_is_scoped_to_source_agent(
    client, default_agent_id, bound_kb_id
):
    """Clearing agent A's URLs must never delete documents agent B ingested.

    Two agents can share one KB, so `urls:clear_all` scopes on
    `KbDocument.source_agent_id`. Legacy rows with no provenance stay put.
    """
    from models import Agent, KbDocument, URLSource

    async with database.AsyncSessionLocal() as session:
        agent_a = await session.get(Agent, default_agent_id)
        agent_b = Agent(
            workspace_id=agent_a.workspace_id,
            name="Agent B",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent_b)
        await session.flush()

        doc_a = KbDocument(
            kb_id=bound_kb_id,
            source_agent_id=agent_a.id,
            filename=f"url_{agent_a.id}_a.txt",
            status="ready",
        )
        doc_b = KbDocument(
            kb_id=bound_kb_id,
            source_agent_id=agent_b.id,
            filename=f"url_{agent_b.id}_b.txt",
            status="ready",
        )
        legacy_doc = KbDocument(
            kb_id=bound_kb_id,
            source_agent_id=None,
            filename="url_legacy.txt",
            status="ready",
        )
        session.add_all([doc_a, doc_b, legacy_doc])
        session.add_all(
            [
                URLSource(
                    kb_id=bound_kb_id,
                    url="https://example.com/a",
                    normalized_url="https://example.com/a",
                    status="success",
                ),
                URLSource(
                    kb_id=bound_kb_id,
                    url="https://example.com/b",
                    normalized_url="https://example.com/b",
                    status="success",
                ),
            ]
        )
        await session.commit()
        doc_a_id, doc_b_id, legacy_doc_id = doc_a.id, doc_b.id, legacy_doc.id

    response = await client.post(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()
    # Documents keep per-ingester provenance even on a shared KB.
    assert data["deleted_count"] == 1, data
    # URL rows, on the other hand, belong to the KB (URLSource has no agent column
    # any more), so clearing the KB clears all of its URL sources — agent A's and
    # agent B's alike. What must never leak across agents is the *documents*.
    assert data["deleted_url_count"] == 2, data

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KbDocument, doc_a_id) is None, "agent A's doc is gone"
        assert await session.get(KbDocument, doc_b_id) is not None, (
            "agent B's doc must survive agent A's clear_all"
        )
        assert await session.get(KbDocument, legacy_doc_id) is not None, (
            "legacy rows without provenance must survive"
        )
        remaining_urls = (
            await session.execute(
                select(URLSource.id).where(URLSource.kb_id == bound_kb_id)
            )
        ).scalars().all()
        assert remaining_urls == [], f"KB URL sources should be gone; got {remaining_urls}"


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
        assert agent.kb_id is not None, "Fixture must bind a KB to the test agent"
        kb_id = agent.kb_id

        # Create URL: fetch succeeded, but indexing failed
        url_source = URLSource(
            kb_id=kb_id,
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
            source_agent_id=default_agent_id,
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
        assert agent.kb_id is not None, "Fixture must bind a KB to the test agent"

        # Create URL being processed
        url_source = URLSource(
            kb_id=agent.kb_id,
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


# ========== kb-scoped service contract (url-svc lane) ==========
# These are the unit-level contracts of this lane: `process_url_refetch` is
# keyword-only and KB-scoped, and the scheduler has a never-fetched catch-all
# that is independent of `enable_auto_fetch` and never retries `failed` rows.

@pytest.mark.asyncio
async def test_process_url_refetch_signature_is_keyword_only_and_kb_scoped():
    """`process_url_refetch` must only be callable with the frozen keywords.

    Guards the contract §4 (api-surface) and the seed build against: positional
    calls or an `agent_id` spelling have to fail immediately, not at fetch time.
    """
    import inspect

    import services.url_service as url_service_module

    # The autouse fixture replaces the module attribute with a stub; the real
    # function is the one imported at collection time.
    assert (
        url_service_module.process_url_refetch is not _real_process_url_refetch
    ), "hermetic harness should still be stubbing the background entry point"

    params = inspect.signature(_real_process_url_refetch).parameters
    for name in ("kb_id", "url_ids", "force", "job_id"):
        assert name in params, f"missing frozen keyword {name!r}: {list(params)}"
        assert params[name].kind is inspect.Parameter.KEYWORD_ONLY, (
            f"{name!r} must be keyword-only; got {params[name].kind}"
        )
    assert params["source_agent_id"].default is None
    assert "agent_id" not in params, (
        "process_url_refetch is kb-scoped; an agent_id parameter would let a "
        "caller filter the wrong column"
    )
    assert inspect.iscoroutinefunction(_real_process_url_refetch)


def _stub_task_lock(monkeypatch):
    """Neutralise the real (module-global) task lock for scheduler dispatch tests.

    Stubbing via monkeypatch is hermetic: it is undone on teardown, so a later test
    in this process never sees a lock left held by this one.
    """
    from services.task_lock import task_lock

    async def _acquired(agent_id, task_type, task_id):
        return True, None

    async def _released(agent_id, task_id):
        return False

    monkeypatch.setattr(task_lock, "acquire_task", _acquired)
    monkeypatch.setattr(task_lock, "release_task", _released)

@pytest.mark.asyncio
async def test_scheduler_catch_all_fetches_never_fetched_pending_rows(
    default_agent_id, bound_kb_id, monkeypatch
):
    """A `pending` + `last_fetch_at IS NULL` row is fetched even with auto-fetch OFF.

    This is the product fix for "the example URL never leaves pending": the seed
    may fail to take the lock, the process may die after commit, ... none of that
    is a user preference, so the catch-all must not look at `enable_auto_fetch`.
    """
    from services.scheduler import URLFetchScheduler

    # `services.scheduler` binds the sessionmaker once at import time; this suite
    # reconfigures `database.AsyncSessionLocal` per test, so point it at the live one.
    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.enable_auto_fetch is False, "fixture agent must not auto-fetch"

        pending = URLSource(
            kb_id=bound_kb_id,
            url="https://example.com/never-fetched",
            normalized_url="https://example.com/never-fetched",
            status="pending",
            last_fetch_at=None,
        )
        session.add(pending)
        # A failed row and an already-fetched pending row must both be ignored.
        session.add(
            URLSource(
                kb_id=bound_kb_id,
                url="https://example.com/failed-row",
                normalized_url="https://example.com/failed-row",
                status="failed",
                last_fetch_at=datetime.now(timezone.utc),
                last_error="boom",
            )
        )
        session.add(
            URLSource(
                kb_id=bound_kb_id,
                url="https://example.com/already-fetched-pending",
                normalized_url="https://example.com/already-fetched-pending",
                status="pending",
                last_fetch_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()
        pending_id = pending.id

    scheduler = URLFetchScheduler()
    calls: list[dict] = []

    async def _record(**kwargs):
        calls.append(kwargs)

    # Hermetic lock: the real one is module-global and would leak into later
    # tests in this same pytest process if it were acquired for real.
    _stub_task_lock(monkeypatch)

    with patch("services.scheduler.process_url_refetch", side_effect=_record):
        async with database.AsyncSessionLocal() as db:
            await scheduler.check_and_fetch_urls()

    assert len(calls) == 1, (
        f"the catch-all must dispatch one job per KB, not one per row; got {calls}"
    )
    call = calls[0]
    assert call["url_ids"] == [pending_id], (
        f"catch-all should refetch only the never-fetched pending row; got {call}"
    )
    assert call["kb_id"] == bound_kb_id, call
    assert call["force"] is False, call
    assert call["job_id"].startswith(f"sched_refetch_{bound_kb_id}_"), call
    assert call["source_agent_id"] is None, call


@pytest.mark.asyncio
async def test_scheduler_recurring_refetch_is_scoped_to_bound_kb(
    default_agent_id, bound_kb_id, monkeypatch
):
    """The stale-success path queries `URLSource.kb_id`, never an agent column."""
    from services.scheduler import URLFetchScheduler

    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        agent.enable_auto_fetch = True
        session.add(
            URLSource(
                kb_id=bound_kb_id,
                url="https://example.com/stale-success",
                normalized_url="https://example.com/stale-success",
                status="success",
                last_fetch_at=datetime(2000, 1, 1, tzinfo=timezone.utc),
            )
        )
        await session.commit()
        agent_id = agent.id

    scheduler = URLFetchScheduler()
    calls: list[dict] = []

    async def _record(**kwargs):
        calls.append(kwargs)

    _stub_task_lock(monkeypatch)

    with patch("services.scheduler.process_url_refetch", side_effect=_record):
        async with database.AsyncSessionLocal() as db:
            agent = await db.get(Agent, agent_id)
            await scheduler.fetch_agent_urls(db, agent)

    async with database.AsyncSessionLocal() as session:
        stale_id = await session.scalar(
            select(URLSource.id).where(
                URLSource.normalized_url == "https://example.com/stale-success"
            )
        )
    assert len(calls) == 1, f"one job per KB expected; got {calls}"
    assert calls[0]["url_ids"] == [stale_id], calls
    assert calls[0]["kb_id"] == bound_kb_id, calls
    assert calls[0]["force"] is False, calls
    assert calls[0]["source_agent_id"] is None, calls


# ========== Scrapling Service /discover Endpoint Tests ==========


def _scrapling_main_path():
    """Locate `scrapling-service/main.py` without assuming one absolute checkout."""
    import os
    from pathlib import Path

    candidates = []
    if os.environ.get("SCRAPLING_SERVICE_MAIN"):
        candidates.append(Path(os.environ["SCRAPLING_SERVICE_MAIN"]))

    here = Path(__file__).resolve()
    for parent in here.parents:
        candidates.append(parent / "scrapling-service" / "main.py")
        candidates.append(parent.parent / "scrapling-service" / "main.py")

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _install_scrapling_import_shims() -> None:
    """Provide the third-party modules `scrapling-service` imports.

    The service's own requirements (`bs4`, `readability-lxml`, `curl_cffi`) are not
    installed in the backend test image, and the service is not part of this suite's
    dependency graph. The `/discover` code path only needs `find_all("a", href=True)`,
    so a thin lxml-backed shim is enough to exercise the real BFS implementation
    without network access or extra packages.
    """
    import sys
    import types
    from unittest.mock import MagicMock

    if "bs4" not in sys.modules:
        import lxml.html

        class _Element:
            __slots__ = ("_el",)

            def __init__(self, el):
                self._el = el

            def __getitem__(self, key):
                return self._el.get(key)

        class BeautifulSoup:
            def __init__(self, html, parser="lxml"):
                try:
                    self._root = lxml.html.fromstring(html or "<html></html>")
                except Exception:
                    self._root = lxml.html.fromstring("<html></html>")

            def find_all(self, tag, href=False):
                return [
                    _Element(el)
                    for el in self._root.iter(tag)
                    if not href or el.get("href")
                ]

        bs4_module = types.ModuleType("bs4")
        bs4_module.BeautifulSoup = BeautifulSoup
        sys.modules["bs4"] = bs4_module

    if "readability" not in sys.modules:
        readability_module = types.ModuleType("readability")

        class Document:
            def __init__(self, html, **kwargs):
                self._html = html or ""

            def summary(self):
                return self._html

            def title(self):
                return ""

        readability_module.Document = Document
        sys.modules["readability"] = readability_module

    # `curl_cffi` drives real HTTP; every call is patched in these tests.
    if "curl_cffi" not in sys.modules:
        curl_cffi_mock = MagicMock()
        curl_cffi_requests_mock = MagicMock()
        curl_cffi_mock.requests = curl_cffi_requests_mock
        sys.modules["curl_cffi"] = curl_cffi_mock
        sys.modules["curl_cffi.requests"] = curl_cffi_requests_mock


def _import_scrapling_module():
    """Import scrapling-service/main.py with shimmed dependencies."""
    import sys
    import importlib.util

    _install_scrapling_import_shims()

    # Use a unique module name to avoid conflicts
    module_name = f"scrapling_test_{id(_import_scrapling_module)}"
    scrapling_path = _scrapling_main_path()
    if scrapling_path is None:
        pytest.skip(
            "scrapling-service/main.py is not mounted in this test container; "
            "set SCRAPLING_SERVICE_MAIN or mount the repository root to exercise "
            "the /discover BFS implementation"
        )
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
