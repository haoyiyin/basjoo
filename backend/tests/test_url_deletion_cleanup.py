import pytest
from sqlalchemy import select

import database
from models import Agent, URLSource, WorkspaceQuota


async def _create_indexed_url(agent_id: str, url: str, r2r_document_id: str | None, used_urls: int) -> int:
    async with database.AsyncSessionLocal() as session:
        agent_result = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_result.scalar_one()
        url_source = URLSource(
            agent_id=agent_id,
            url=url,
            normalized_url=url,
            status="success",
            is_indexed=True,
            r2r_document_id=r2r_document_id,
        )
        session.add(url_source)
        quota_result = await session.execute(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
        )
        quota = quota_result.scalar_one_or_none()
        if not quota:
            quota = WorkspaceQuota(workspace_id=agent.workspace_id)
            session.add(quota)
        quota.used_urls = used_urls
        await session.commit()
        await session.refresh(url_source)
        return url_source.id


async def _quota_used_urls(agent_id: str) -> int:
    async with database.AsyncSessionLocal() as session:
        agent_result = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_result.scalar_one()
        quota_result = await session.execute(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
        )
        return quota_result.scalar_one().used_urls


@pytest.mark.parametrize("should_raise", [False, True])
@pytest.mark.asyncio
async def test_delete_url_fails_and_preserves_db_when_r2r_unassign_fails(
    client,
    default_agent_id,
    monkeypatch,
    should_raise,
):
    url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/stale-delete",
        "doc_stale_delete",
        1,
    )

    class FailingR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            if should_raise:
                raise RuntimeError("r2r unavailable")
            return False

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", FailingR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]

    async with database.AsyncSessionLocal() as session:
        url_source = await session.get(URLSource, url_id)
        assert url_source is not None
        assert url_source.r2r_document_id == "doc_stale_delete"
        assert url_source.is_indexed is True
    assert await _quota_used_urls(default_agent_id) == 1


@pytest.mark.parametrize("should_raise", [False, True])
@pytest.mark.asyncio
async def test_clear_all_urls_fails_and_preserves_db_when_r2r_unassign_fails(
    client,
    default_agent_id,
    monkeypatch,
    should_raise,
):
    first_url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/clear-one",
        "doc_clear_1",
        2,
    )
    second_url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/clear-two",
        "doc_clear_2",
        2,
    )

    class FailingR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            if document_id == "doc_clear_1":
                if should_raise:
                    raise RuntimeError("r2r unavailable")
                return False
            return True

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", FailingR2RClient)

    response = await client.delete(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]

    async with database.AsyncSessionLocal() as session:
        first_url = await session.get(URLSource, first_url_id)
        second_url = await session.get(URLSource, second_url_id)
        assert first_url is not None
        assert second_url is not None
        assert first_url.r2r_document_id == "doc_clear_1"
        assert second_url.r2r_document_id == "doc_clear_2"
    assert await _quota_used_urls(default_agent_id) == 2


@pytest.mark.parametrize("should_raise", [False, True])
@pytest.mark.asyncio
async def test_delete_legacy_indexed_url_fails_and_preserves_db_when_r2r_cleanup_fails(
    client,
    default_agent_id,
    monkeypatch,
    should_raise,
):
    url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/legacy-delete",
        None,
        1,
    )

    class FailingR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {
                    "id": "legacy_doc_delete",
                    "metadata": {"source_type": "url", "url_source_id": url_id},
                }
            ]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            if should_raise:
                raise RuntimeError("r2r unavailable")
            return False

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", FailingR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]

    async with database.AsyncSessionLocal() as session:
        url_source = await session.get(URLSource, url_id)
        assert url_source is not None
        assert url_source.r2r_document_id is None
        assert url_source.is_indexed is True


@pytest.mark.asyncio
async def test_delete_legacy_indexed_url_supports_string_metadata_id(
    client,
    default_agent_id,
    monkeypatch,
):
    url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/legacy-string-id",
        None,
        1,
    )
    calls = []

    class SuccessfulR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {
                    "id": "legacy_doc_string_id",
                    "metadata": {"source_type": "url", "url_source_id": str(url_id)},
                }
            ]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 200
    assert calls == [(default_agent_id, "legacy_doc_string_id")]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is None
    assert await _quota_used_urls(default_agent_id) == 0


@pytest.mark.asyncio
async def test_delete_legacy_indexed_url_supports_url_metadata_fallback(
    client,
    default_agent_id,
    monkeypatch,
):
    url = "https://example.com/legacy-by-url"
    url_id = await _create_indexed_url(default_agent_id, url, None, 1)
    calls = []

    class SuccessfulR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [{"id": "legacy_doc_by_url", "metadata": {"source_type": "url", "url": url}}]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 200
    assert calls == [(default_agent_id, "legacy_doc_by_url")]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is None
    assert await _quota_used_urls(default_agent_id) == 0


@pytest.mark.asyncio
async def test_delete_url_removes_known_and_matching_legacy_r2r_documents(
    client,
    default_agent_id,
    monkeypatch,
):
    url = "https://example.com/known-and-legacy"
    url_id = await _create_indexed_url(default_agent_id, url, "doc_known", 1)
    calls = []

    class SuccessfulR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {"id": "doc_known", "metadata": {"source_type": "url", "url_source_id": str(url_id)}},
                {"id": "doc_legacy", "metadata": {"source_type": "url", "url": url}},
            ]

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 200
    assert calls == [(default_agent_id, "doc_known"), (default_agent_id, "doc_legacy")]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is None


@pytest.mark.asyncio
async def test_delete_legacy_indexed_url_fails_when_no_r2r_match_is_found(
    client,
    default_agent_id,
    monkeypatch,
):
    url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/legacy-missing",
        None,
        1,
    )

    class MissingR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [{"id": "other_doc", "metadata": {"source_type": "url", "url_source_id": "other"}}]

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", MissingR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is not None


@pytest.mark.parametrize("failure_mode", ["list", "unassign"])
@pytest.mark.asyncio
async def test_clear_all_legacy_indexed_urls_fails_and_preserves_db_when_r2r_cleanup_fails(
    client,
    default_agent_id,
    monkeypatch,
    failure_mode,
):
    url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/legacy-clear",
        None,
        1,
    )

    class FailingR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            if failure_mode == "list":
                raise RuntimeError("r2r unavailable")
            return [
                {
                    "id": "legacy_doc_clear",
                    "metadata": {"source_type": "url", "url_source_id": url_id},
                }
            ]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            return False

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", FailingR2RClient)

    response = await client.delete(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]

    async with database.AsyncSessionLocal() as session:
        url_source = await session.get(URLSource, url_id)
        assert url_source is not None
        assert url_source.r2r_document_id is None
        assert url_source.is_indexed is True
    assert await _quota_used_urls(default_agent_id) == 1


@pytest.mark.asyncio
async def test_clear_all_legacy_indexed_urls_deletes_after_verified_cleanup(
    client,
    default_agent_id,
    monkeypatch,
):
    first_url = "https://example.com/legacy-clear-id"
    second_url = "https://example.com/legacy-clear-url"
    first_url_id = await _create_indexed_url(default_agent_id, first_url, None, 2)
    second_url_id = await _create_indexed_url(default_agent_id, second_url, None, 2)
    calls = []

    class SuccessfulR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {
                    "id": "legacy_doc_clear_id",
                    "metadata": {"source_type": "url", "url_source_id": str(first_url_id)},
                },
                {
                    "id": "legacy_doc_clear_url",
                    "metadata": {"source_type": "url", "url": second_url},
                },
            ]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 200
    assert calls == [
        (default_agent_id, "legacy_doc_clear_id"),
        (default_agent_id, "legacy_doc_clear_url"),
    ]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, first_url_id) is None
        assert await session.get(URLSource, second_url_id) is None
    assert await _quota_used_urls(default_agent_id) == 0


@pytest.mark.asyncio
async def test_delete_failed_url_with_content_still_removes_matching_r2r_document(
    client,
    default_agent_id,
    monkeypatch,
):
    url = "https://example.com/cancelled-with-content"
    url_id = await _create_indexed_url(default_agent_id, url, None, 1)
    calls = []

    async with database.AsyncSessionLocal() as session:
        url_source = await session.get(URLSource, url_id)
        url_source.status = "failed"
        url_source.is_indexed = False
        url_source.content = "Fetched before cancellation"
        await session.commit()

    class SuccessfulR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [{"id": "doc_cancelled", "metadata": {"source_type": "url", "url": url}}]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")

    assert response.status_code == 200
    assert calls == [(default_agent_id, "doc_cancelled")]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is None


@pytest.mark.asyncio
async def test_delete_url_returns_conflict_while_index_rebuild_is_running(
    client,
    default_agent_id,
):
    from services.task_lock import TaskType, task_lock

    url_id = await _create_indexed_url(default_agent_id, "https://example.com/rebuild-active", None, 1)
    task_id = "rebuild_test_active"
    acquired, error = await task_lock.acquire_task(default_agent_id, TaskType.INDEX_REBUILD, task_id)
    assert acquired, error

    try:
        response = await client.delete(f"/api/v1/urls:delete?agent_id={default_agent_id}&url_id={url_id}")
    finally:
        await task_lock.release_task(default_agent_id, task_id)

    assert response.status_code == 409
    assert "rebuild_test_active" in response.json()["detail"]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is not None


@pytest.mark.asyncio
async def test_clear_all_urls_removes_known_and_matching_legacy_r2r_documents(
    client,
    default_agent_id,
    monkeypatch,
):
    url = "https://example.com/clear-known-and-legacy"
    url_id = await _create_indexed_url(default_agent_id, url, "doc_clear_known", 1)
    calls = []

    class SuccessfulR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {"id": "doc_clear_known", "metadata": {"source_type": "url", "url_source_id": str(url_id)}},
                {"id": "doc_clear_legacy", "metadata": {"source_type": "url", "url": url}},
            ]

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 200
    assert calls == [(default_agent_id, "doc_clear_known"), (default_agent_id, "doc_clear_legacy")]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, url_id) is None
    assert await _quota_used_urls(default_agent_id) == 0


@pytest.mark.asyncio
async def test_clear_all_urls_marks_successfully_unassigned_rows_unindexed_on_later_failure(
    client,
    default_agent_id,
    monkeypatch,
):
    first_url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/partial-clear-one",
        "doc_partial_1",
        2,
    )
    second_url_id = await _create_indexed_url(
        default_agent_id,
        "https://example.com/partial-clear-two",
        "doc_partial_2",
        2,
    )

    class PartiallyFailingR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            return document_id == "doc_partial_1"

        async def list_documents(self, agent_id: str) -> list[dict]:
            return []

    monkeypatch.setattr("api.v1.url_endpoints.R2RClient", PartiallyFailingR2RClient)

    response = await client.delete(f"/api/v1/urls:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 502
    async with database.AsyncSessionLocal() as session:
        first_url = await session.get(URLSource, first_url_id)
        second_url = await session.get(URLSource, second_url_id)
        assert first_url is not None
        assert first_url.is_indexed is False
        assert first_url.r2r_document_id is None
        assert second_url is not None
        assert second_url.is_indexed is True
        assert second_url.r2r_document_id == "doc_partial_2"
    assert await _quota_used_urls(default_agent_id) == 2
