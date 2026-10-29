"""Upload filename hygiene (B3).

The stored `KbDocument` row, the on-disk file and the filename returned by
`files:list` must agree. `kb_document_processor.save_uploaded_file` used to
sanitise only the on-disk copy, so `../../evil.md` and `a\\x00.txt` reached the
database verbatim and a Windows device name like `CON.txt` was accepted.
"""

from io import BytesIO

import pytest
from sqlalchemy import select

import database
from models import KbDocument

@pytest.fixture(autouse=True)
def hermetic_processing(monkeypatch):
    """Never let the background ingest task reach a real embedding provider."""
    from services.kb_document_processor import KbDocumentProcessor

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(KbDocumentProcessor, "process_document", _noop, raising=True)
    yield

async def _uploaded_rows(kb_id: str) -> list[KbDocument]:
    async with database.AsyncSessionLocal() as session:
        return list(
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

class TestSanitiseUploadFilename:
    """The helper itself."""

    def test_normal_name_is_unchanged(self):
        from services.kb_document_processor import sanitise_upload_filename

        assert sanitise_upload_filename("quarterly report.txt") == (
            "quarterly report.txt"
        )

    def test_nul_and_control_characters_are_stripped(self):
        from services.kb_document_processor import sanitise_upload_filename

        assert sanitise_upload_filename("a\x00.txt") == "a.txt"
        assert sanitise_upload_filename("a\x1b\x07b.md") == "ab.md"

    def test_path_separators_are_neutralised(self):
        from services.kb_document_processor import sanitise_upload_filename

        name = sanitise_upload_filename("../../evil.md")

        assert name == ".._.._evil.md"
        assert "/" not in name and "\\" not in name
        assert sanitise_upload_filename("C:\\temp\\x.txt") == "C:_temp_x.txt"

    @pytest.mark.parametrize(
        "name",
        [
            "CON.txt",
            "con.txt",
            "PRN.pdf",
            "aux.md",
            "NUL.txt",
            "COM1.txt",
            "com9.txt",
            "LPT1.txt",
            "lpt9.txt",
            "CON",
        ],
    )
    def test_windows_reserved_basenames_are_prefixed(self, name):
        from services.kb_document_processor import sanitise_upload_filename

        result = sanitise_upload_filename(name)

        assert result == f"_{name}", result
        assert result.lstrip("_").split(".")[0].upper() in {
            "CON",
            "PRN",
            "AUX",
            "NUL",
            *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10)),
        }

    def test_overlong_name_is_capped_but_keeps_its_extension(self):
        from services.kb_document_processor import sanitise_upload_filename

        result = sanitise_upload_filename("x" * 300 + ".md")

        assert len(result) == 200
        assert result.endswith(".md")
        assert result == "x" * 197 + ".md"

    def test_whitespace_is_collapsed(self):
        from services.kb_document_processor import sanitise_upload_filename

        assert sanitise_upload_filename("  a   b  .txt") == "a b .txt"

    def test_nothing_left_returns_empty(self):
        from services.kb_document_processor import sanitise_upload_filename

        assert sanitise_upload_filename("\x00\x01\x1b") == ""
        assert sanitise_upload_filename("   ") == ""
        assert sanitise_upload_filename("") == ""

class TestUploadEndpointStoresSanitisedName:
    """The row, the response and the on-disk file agree."""

    pytestmark = pytest.mark.asyncio

    async def test_hostile_filenames_are_sanitised_before_the_row_exists(
        self, client, bound_kb_id
    ):
        response = await client.post(
            f"/api/v1/knowledge-bases/{bound_kb_id}/files:upload",
            files=[
                ("files", ("../../evil.md", BytesIO(b"traversal"), "text/markdown")),
                ("files", ("CON.txt", BytesIO(b"device name"), "text/plain")),
                ("files", ("  a   b  .txt", BytesIO(b"spaced"), "text/plain")),
            ],
        )

        assert response.status_code == 200, response.text
        assert response.json()["uploaded"] == 3, response.text

        names = [row.filename for row in await _uploaded_rows(bound_kb_id)]

        assert names == [".._.._evil.md", "_CON.txt", "a b .txt"], names
        assert all("/" not in name and "\\" not in name for name in names)
        assert all(ch.isprintable() for name in names for ch in name)

    async def test_overlong_filename_is_capped_in_the_row(
        self, client, bound_kb_id
    ):
        response = await client.post(
            f"/api/v1/knowledge-bases/{bound_kb_id}/files:upload",
            files=[("files", ("y" * 300 + ".md", BytesIO(b"long"), "text/markdown"))],
        )

        assert response.status_code == 200, response.text
        rows = await _uploaded_rows(bound_kb_id)

        assert len(rows) == 1
        assert len(rows[0].filename) == 200
        assert rows[0].filename.endswith(".md")

    async def test_unusable_filename_is_rejected_through_errors(
        self, client, bound_kb_id
    ):
        response = await client.post(
            f"/api/v1/knowledge-bases/{bound_kb_id}/files:upload",
            files=[("files", ("   ", BytesIO(b"nothing left"), "text/plain"))],
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["uploaded"] == 0, body
        assert body["failed"] == 1, body
        assert len(body["errors"]) == 1, body
        assert "unusable filename" in body["errors"][0], body
        assert await _uploaded_rows(bound_kb_id) == []
