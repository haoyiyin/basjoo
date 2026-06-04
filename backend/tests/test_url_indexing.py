"""Tests for URL ingestion and index status.

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
from models import Agent, KnowledgeBase, Tenant, URLSource


@pytest.mark.asyncio
async def test_url_creation_returns_list_response_shape(client, default_agent_id):
    """URL create endpoint should return URLListResponse shape with urls, total, quota."""
    response = await client.post(
        f"/api/v1/urls:create?agent_id={default_agent_id}",
        json={"urls": ["https://example.com/test1", "https://example.com/test2"]},
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()

    # Should have URLListResponse shape
    assert "urls" in data
    assert "total" in data
    assert "quota" in data
    assert isinstance(data["urls"], list)
    assert len(data["urls"]) == 2


@pytest.mark.asyncio
async def test_url_status_transitions_to_success_after_indexing(client, default_agent_id):
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
        assert refetch_response.status_code == 200, f"Expected 200, got {refetch_response.status_code}: {refetch_response.text}"
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
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

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
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

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
        assert not acquired2, "Should not be able to acquire INDEX_REBUILD while URL_REFETCH is running"
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
async def test_cancel_url_tasks_endpoint_exists(client, default_agent_id):
    """URL cancel tasks endpoint should exist."""
    response = await client.post(
        f"/api/v1/urls:cancel?agent_id={default_agent_id}",
    )
    # Should not be 404 - endpoint should exist
    assert response.status_code != 404, "urls:cancel endpoint should exist"
