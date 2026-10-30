"""File upload → KB document ingestion, now bound-KB only.

Uploads land in the agent's *bound* KB and are tagged with `source_agent_id`.
There is no implicit KB creation any more: an agent without a binding gets 409 and
is directed at `PUT /api/v1/agents/{id}/knowledge-base`.
"""

from io import BytesIO

import pytest
from sqlalchemy import select

import database
from models import Agent, KbDocument

pytestmark = pytest.mark.asyncio


async def _uploads_for(kb_id: str) -> list[KbDocument]:
    async with database.AsyncSessionLocal() as session:
        return (
            (
                await session.execute(
                    select(KbDocument)
                    .where(KbDocument.kb_id == kb_id)
                    .order_by(KbDocument.created_at)
                )
            )
            .scalars()
            .all()
        )


class TestFileUploadKbIngestion:
    """Uploads create KbDocuments inside the agent's bound KB."""

    async def test_upload_files_creates_kb_document_records(
        self, client, default_agent_id, bound_kb_id
    ):
        files = {
            "files": (
                "test_document.txt",
                BytesIO(b"This is test content for document processing."),
                "text/plain",
            )
        }

        response = await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )

        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()
        assert data["uploaded"] == 1
        assert data["failed"] == 0
        assert len(data["files"]) == 1

        file_item = data["files"][0]
        assert file_item["filename"] == "test_document.txt"
        # #47 two-phase upload: the row is handed to the scheduler, so the
        # response says `processing` (never `ready`) and names the queue stage.
        # Before #47 this was `pending` only because the bytes were about to be
        # parsed inline by `BackgroundTasks`.
        assert file_item["status"] == "processing"
        assert file_item["processing_stage"] == "uploaded"
        assert "id" in file_item

        documents = await _uploads_for(bound_kb_id)
        assert len(documents) == 1
        assert documents[0].filename == "test_document.txt"
        # Provenance is recorded: the upload knows which agent produced it.
        assert documents[0].source_agent_id == default_agent_id

    async def test_upload_files_enforces_file_count_limit(
        self, client, default_agent_id
    ):
        files = [
            ("files", (f"file{i}.txt", BytesIO(b"content"), "text/plain"))
            for i in range(6)
        ]

        response = await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )

        assert response.status_code == 400
        data = response.json()
        assert "max" in data.get("detail", "").lower() or "5" in data.get("detail", "")

    async def test_upload_files_rejects_unsupported_extensions(
        self, client, default_agent_id, bound_kb_id
    ):
        files = {
            "files": (
                "malware.exe",
                BytesIO(b"malicious content"),
                "application/octet-stream",
            )
        }

        response = await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )

        assert response.status_code == 200
        data = response.json()
        assert data["failed"] == 1
        assert len(data["errors"]) == 1
        assert await _uploads_for(bound_kb_id) == []

    async def test_upload_without_bound_kb_is_409_and_creates_nothing(
        self, client
    ):
        """No implicit KB creation: binding is an explicit super_admin action."""
        from models import Workspace

        async with database.AsyncSessionLocal() as session:
            workspace = (
                await session.execute(select(Workspace).limit(1))
            ).scalar_one_or_none()
            assert workspace is not None

            agent = Agent(
                workspace_id=workspace.id,
                name="Test Agent No KB",
                model="deepseek-v4-flash",
                api_base="https://api.deepseek.com/v1",
                provider_type="deepseek",
            )
            session.add(agent)
            await session.commit()
            agent_id = agent.id

        files = {
            "files": ("test.txt", BytesIO(b"Content for auto-KB creation test."), "text/plain")
        }
        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}", files=files
        )

        assert response.status_code == 409
        detail = response.json()["detail"].lower()
        assert "knowledge base" in detail
        assert "bind" in detail

        async with database.AsyncSessionLocal() as session:
            updated_agent = await session.get(Agent, agent_id)
            assert updated_agent.kb_id is None, "Upload must not bind a KB on its own"

    async def test_upload_files_returns_kb_document_status(
        self, client, default_agent_id
    ):
        files = {
            "files": ("status_test.pdf", BytesIO(b"Status test content."), "application/pdf")
        }

        response = await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )

        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert len(data["files"]) == 1
        file_item = data["files"][0]
        assert "status" in file_item
        assert file_item["status"] in ["pending", "processing"]

    async def test_file_list_exposes_localized_processing_error_details(
        self, client, default_agent_id
    ):
        files = {
            "files": (
                "error_prop_test.txt",
                BytesIO(b"Test content for error propagation"),
                "text/plain",
            )
        }
        response = await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )
        assert response.status_code == 200
        file_id = response.json()["files"][0]["id"]

        async with database.AsyncSessionLocal() as session:
            doc = await session.get(KbDocument, file_id)
            assert doc is not None
            doc.status = "error"
            doc.error_message = (
                "BadZipFile: File is not a zip file; PackageNotFoundError traceback"
            )
            await session.commit()

        raw_markers = [
            "BadZipFile",
            "PackageNotFoundError",
            "traceback",
            "zip file",
            "Chunking failed",
            "text too large",
        ]

        for locale, expected_fragments in [
            ("en-US", ["valid", "document"]),
            ("zh-CN", ["文件", "文档"]),
        ]:
            response = await client.get(
                f"/api/v1/files:list?agent_id={default_agent_id}&locale={locale}"
            )
            assert response.status_code == 200
            data = response.json()

            file_item = next((f for f in data["files"] if f["id"] == file_id), None)
            assert file_item is not None
            assert file_item["status"] == "failed"
            assert file_item.get("error_message")

            message = file_item["error_message"]
            normalized_message = message.lower()
            for fragment in expected_fragments:
                assert fragment.lower() in normalized_message
            for marker in raw_markers:
                assert marker.lower() not in normalized_message

    async def test_file_list_shows_explicit_processing_state(
        self, client, default_agent_id
    ):
        files = {
            "files": ("state_test.txt", BytesIO(b"Test content for state tracking"), "text/plain")
        }
        response = await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )
        assert response.status_code == 200
        file_id = response.json()["files"][0]["id"]

        async with database.AsyncSessionLocal() as session:
            doc = await session.get(KbDocument, file_id)
            doc.status = "processing"
            await session.commit()

        response = await client.get(f"/api/v1/files:list?agent_id={default_agent_id}")
        assert response.status_code == 200
        data = response.json()

        file_item = next((f for f in data["files"] if f["id"] == file_id), None)
        assert file_item is not None
        assert file_item["status"] in ["pending", "processing", "ready", "error"]

    async def test_files_are_scoped_to_the_bound_kb(
        self, client, default_agent_id, bound_kb_id, unbound_kb_id
    ):
        """Files:list reports the KB's library, not another KB's."""
        files = {
            "files": ("scoped.txt", BytesIO(b"Scoped content"), "text/plain")
        }
        await client.post(
            f"/api/v1/files:upload?agent_id={default_agent_id}", files=files
        )

        listed = await client.get(f"/api/v1/files:list?agent_id={default_agent_id}")
        assert listed.status_code == 200
        names = {f["filename"] for f in listed.json()["files"]}
        assert "scoped.txt" in names

        assert len(await _uploads_for(bound_kb_id)) == 1
        assert await _uploads_for(unbound_kb_id) == []
