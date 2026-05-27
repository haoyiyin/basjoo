"""Tests for file deletion R2R cleanup fail-closed behavior."""

import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeFile


async def _create_file(
    agent_id: str,
    file_id: str,
    filename: str,
    r2r_document_id: str | None,
    status: str = "ready",
) -> str:
    async with database.AsyncSessionLocal() as session:
        agent_result = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_result.scalar_one()
        kf = KnowledgeFile(
            id=file_id,
            agent_id=agent_id,
            filename=filename,
            file_type="txt",
            status=status,
            r2r_document_id=r2r_document_id,
        )
        session.add(kf)
        await session.commit()
        await session.refresh(kf)
        return kf.id


@pytest.mark.parametrize("should_raise", [False, True])
@pytest.mark.asyncio
async def test_delete_file_fails_and_preserves_db_when_r2r_unassign_fails(
    client,
    default_agent_id,
    monkeypatch,
    should_raise,
):
    file_id = await _create_file(default_agent_id, "kf_test_1", "test.txt", "doc_file_1")

    class FailingR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            if should_raise:
                raise RuntimeError("r2r unavailable")
            return False

        async def list_documents(self, agent_id: str) -> list[dict]:
            return []

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", FailingR2RClient)

    response = await client.delete(f"/api/v1/files:delete?agent_id={default_agent_id}&file_id={file_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]

    async with database.AsyncSessionLocal() as session:
        kf = await session.get(KnowledgeFile, file_id)
        assert kf is not None
        assert kf.r2r_document_id == "doc_file_1"


@pytest.mark.parametrize("should_raise", [False, True])
@pytest.mark.asyncio
async def test_clear_all_files_fails_and_preserves_all_db_rows_on_failure(
    client,
    default_agent_id,
    monkeypatch,
    should_raise,
):
    """When first file cleanup fails, all DB rows and r2r_document_ids should be preserved for retry."""
    first_file_id = await _create_file(default_agent_id, "kf_clear_1", "clear_one.txt", "doc_clear_1")
    second_file_id = await _create_file(default_agent_id, "kf_clear_2", "clear_two.txt", "doc_clear_2")

    class FailingR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            if document_id == "doc_clear_1":
                if should_raise:
                    raise RuntimeError("r2r unavailable")
                return False
            return True

        async def list_documents(self, agent_id: str) -> list[dict]:
            return []

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", FailingR2RClient)

    response = await client.delete(f"/api/v1/files:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]

    # All files preserved with original r2r_document_ids for retry
    async with database.AsyncSessionLocal() as session:
        first_kf = await session.get(KnowledgeFile, first_file_id)
        second_kf = await session.get(KnowledgeFile, second_file_id)
        assert first_kf is not None
        assert second_kf is not None
        assert first_kf.r2r_document_id == "doc_clear_1"
        assert second_kf.r2r_document_id == "doc_clear_2"


@pytest.mark.asyncio
async def test_delete_legacy_file_uses_knowledge_file_id_metadata(
    client,
    default_agent_id,
    monkeypatch,
):
    file_id = await _create_file(default_agent_id, "kf_legacy_id", "legacy_id.txt", None)
    calls = []

    class SuccessfulR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {
                    "id": "doc_legacy_file_id",
                    "metadata": {"source_type": "file", "knowledge_file_id": file_id},
                }
            ]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/files:delete?agent_id={default_agent_id}&file_id={file_id}")

    assert response.status_code == 200
    assert calls == [(default_agent_id, "doc_legacy_file_id")]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeFile, file_id) is None


@pytest.mark.asyncio
async def test_delete_legacy_file_fails_when_no_r2r_match_found(
    client,
    default_agent_id,
    monkeypatch,
):
    file_id = await _create_file(default_agent_id, "kf_legacy_missing", "legacy_missing.txt", None)

    class MissingR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [{"id": "other_doc", "metadata": {"source_type": "file", "knowledge_file_id": "other"}}]

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", MissingR2RClient)

    response = await client.delete(f"/api/v1/files:delete?agent_id={default_agent_id}&file_id={file_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeFile, file_id) is not None


@pytest.mark.asyncio
async def test_delete_legacy_file_fails_when_filename_match_is_ambiguous(
    client,
    default_agent_id,
    monkeypatch,
):
    file_id = await _create_file(default_agent_id, "kf_ambiguous", "ambiguous.txt", None)

    class AmbiguousR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {"id": "doc_amb_1", "metadata": {"source_type": "file", "filename": "ambiguous.txt"}},
                {"id": "doc_amb_2", "metadata": {"source_type": "file", "filename": "ambiguous.txt"}},
            ]

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", AmbiguousR2RClient)

    response = await client.delete(f"/api/v1/files:delete?agent_id={default_agent_id}&file_id={file_id}")

    assert response.status_code == 502
    assert "search index" in response.json()["detail"]
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeFile, file_id) is not None


@pytest.mark.asyncio
async def test_delete_failed_file_without_r2r_doc_does_not_require_listing(
    client,
    default_agent_id,
    monkeypatch,
):
    file_id = await _create_file(default_agent_id, "kf_failed", "failed.txt", None, status="failed")
    list_called = False

    class NoListingR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            nonlocal list_called
            list_called = True
            raise RuntimeError("should not be called")

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            return True

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", NoListingR2RClient)

    response = await client.delete(f"/api/v1/files:delete?agent_id={default_agent_id}&file_id={file_id}")

    assert response.status_code == 200
    assert list_called is False
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeFile, file_id) is None


@pytest.mark.asyncio
async def test_clear_all_files_reuses_document_listing_for_legacy_files(
    client,
    default_agent_id,
    monkeypatch,
):
    first_file_id = await _create_file(default_agent_id, "kf_legacy_list_1", "legacy_list_1.txt", None)
    second_file_id = await _create_file(default_agent_id, "kf_legacy_list_2", "legacy_list_2.txt", None)
    list_calls = 0
    unassign_calls = []

    class CountingR2RClient:
        async def list_documents(self, agent_id: str) -> list[dict]:
            nonlocal list_calls
            list_calls += 1
            return [
                {"id": "doc_legacy_1", "metadata": {"source_type": "file", "knowledge_file_id": first_file_id}},
                {"id": "doc_legacy_2", "metadata": {"source_type": "file", "knowledge_file_id": second_file_id}},
            ]

        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            unassign_calls.append((agent_id, document_id))
            return True

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", CountingR2RClient)

    response = await client.delete(f"/api/v1/files:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 200
    assert list_calls == 1
    assert len(unassign_calls) == 2
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeFile, first_file_id) is None
        assert await session.get(KnowledgeFile, second_file_id) is None


@pytest.mark.asyncio
async def test_delete_file_removes_known_and_matching_legacy_r2r_documents(
    client,
    default_agent_id,
    monkeypatch,
):
    file_id = await _create_file(default_agent_id, "kf_both", "both.txt", "doc_known")
    calls = []

    class SuccessfulR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            calls.append((agent_id, document_id))
            return True

        async def list_documents(self, agent_id: str) -> list[dict]:
            return [
                {"id": "doc_known", "metadata": {"source_type": "file", "knowledge_file_id": file_id}},
                {"id": "doc_legacy", "metadata": {"source_type": "file", "filename": "both.txt", "file_type": "txt"}},
            ]

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", SuccessfulR2RClient)

    response = await client.delete(f"/api/v1/files:delete?agent_id={default_agent_id}&file_id={file_id}")

    assert response.status_code == 200
    assert (default_agent_id, "doc_known") in calls
    assert (default_agent_id, "doc_legacy") in calls
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeFile, file_id) is None


@pytest.mark.asyncio
async def test_clear_all_files_preserves_all_rows_on_second_file_failure(
    client,
    default_agent_id,
    monkeypatch,
):
    """When second file cleanup fails, all DB rows preserved with original doc ids for retry."""
    first_file_id = await _create_file(default_agent_id, "kf_partial_1", "partial_1.txt", "doc_partial_1")
    second_file_id = await _create_file(default_agent_id, "kf_partial_2", "partial_2.txt", "doc_partial_2")

    class PartiallyFailingR2RClient:
        async def unassign_document(self, agent_id: str, document_id: str) -> bool:
            return document_id == "doc_partial_1"

        async def list_documents(self, agent_id: str) -> list[dict]:
            return []

    monkeypatch.setattr("api.v1.file_endpoints.R2RClient", PartiallyFailingR2RClient)

    response = await client.delete(f"/api/v1/files:clear_all?agent_id={default_agent_id}")

    assert response.status_code == 502
    async with database.AsyncSessionLocal() as session:
        first_kf = await session.get(KnowledgeFile, first_file_id)
        second_kf = await session.get(KnowledgeFile, second_file_id)
        assert first_kf is not None
        assert first_kf.r2r_document_id == "doc_partial_1"  # preserved for retry
        assert second_kf is not None
        assert second_kf.r2r_document_id == "doc_partial_2"