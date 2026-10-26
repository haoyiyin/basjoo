"""Deleting one URL must delete the document/chunks/points it produced (#17).

`DELETE /knowledge-bases/{kb_id}/urls:delete?url_id=…` used to drop only the
`URLSource` row: the derived `url_{id}.txt` KbDocument, its KbChunk rows and its
Qdrant points stayed retrievable. These tests pin the cascade and, just as
importantly, what it must NOT touch: sibling URL documents and uploaded files.

Qdrant is stubbed so nothing here touches a socket.
"""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

import database
from models import KbChunk, KbDocument, URLSource

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def stub_qdrant(monkeypatch):
    """No network: every Qdrant method the delete path can reach is a stub."""
    delete_points = AsyncMock(return_value=1)
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_points_by_doc_id",
        delete_points,
    )
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_collection",
        AsyncMock(return_value=True),
    )
    yield delete_points


async def _seed(bound_kb_id: str) -> dict[str, str]:
    """URL A + its url doc + chunk, sibling URL B + its doc, and an upload."""
    async with database.AsyncSessionLocal() as session:
        url_a = URLSource(
            kb_id=bound_kb_id,
            url="https://example.com/cascade-a",
            normalized_url="https://example.com/cascade-a",
            status="success",
            is_indexed=True,
            content="Content A",
        )
        url_b = URLSource(
            kb_id=bound_kb_id,
            url="https://example.com/cascade-b",
            normalized_url="https://example.com/cascade-b",
            status="success",
            is_indexed=True,
            content="Content B",
        )
        session.add_all([url_a, url_b])
        await session.flush()

        doc_a = KbDocument(
            kb_id=bound_kb_id,
            filename=f"url_{url_a.id}.txt",
            file_type="txt",
            status="ready",
            chunk_count=1,
        )
        doc_b = KbDocument(
            kb_id=bound_kb_id,
            filename=f"url_{url_b.id}.txt",
            file_type="txt",
            status="ready",
            chunk_count=1,
        )
        keep = KbDocument(
            kb_id=bound_kb_id,
            filename="keep.txt",
            file_type="txt",
            status="ready",
            chunk_count=0,
        )
        session.add_all([doc_a, doc_b, keep])
        await session.flush()

        session.add(
            KbChunk(
                kb_id=bound_kb_id,
                doc_id=doc_a.id,
                chunk_index=0,
                content_hash="chunk-a",
            )
        )
        await session.commit()

        return {
            "url_a": str(url_a.id),
            "url_b": str(url_b.id),
            "doc_a": doc_a.id,
            "doc_b": doc_b.id,
            "keep": keep.id,
        }


async def test_delete_one_url_cascades_to_its_document_only(
    client, bound_kb_id, stub_qdrant
):
    ids = await _seed(bound_kb_id)

    response = await client.delete(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:delete?url_id={ids['url_a']}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["success"] is True

    async with database.AsyncSessionLocal() as session:
        assert await session.get(URLSource, int(ids["url_a"])) is None, (
            "the deleted URL row must be gone"
        )
        assert await session.get(KbDocument, ids["doc_a"]) is None, (
            "the document derived from the deleted URL must be gone"
        )
        chunks = (
            await session.execute(
                select(KbChunk).where(KbChunk.doc_id == ids["doc_a"])
            )
        ).scalars().all()
        assert chunks == [], "chunks of the deleted URL document must be gone"

        assert await session.get(KbDocument, ids["doc_b"]) is not None, (
            "a sibling URL's document must survive"
        )
        assert await session.get(KbDocument, ids["keep"]) is not None, (
            "an uploaded document must survive"
        )
        assert await session.get(URLSource, int(ids["url_b"])) is not None

    stub_qdrant.assert_awaited_once()
    assert stub_qdrant.await_args.args[0] == bound_kb_id
    assert stub_qdrant.await_args.args[1] == ids["doc_a"]


async def test_clear_all_urls_still_deletes_every_url_document(
    client, bound_kb_id, stub_qdrant
):
    """`clear_all` keeps working through the shared cascade helper."""
    ids = await _seed(bound_kb_id)

    response = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:clear_all"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deleted_url_count"] == 2
    assert body["deleted_doc_count"] == 2
    assert body["deleted_qdrant_count"] == 2
    assert body["deleted_count"] == body["deleted_doc_count"]

    async with database.AsyncSessionLocal() as session:
        remaining_urls = (
            await session.execute(
                select(URLSource.id).where(URLSource.kb_id == bound_kb_id)
            )
        ).scalars().all()
        assert remaining_urls == []

        assert await session.get(KbDocument, ids["doc_a"]) is None
        assert await session.get(KbDocument, ids["doc_b"]) is None
        assert await session.get(KbDocument, ids["keep"]) is not None, (
            "clear_all must not touch uploaded documents"
        )
        assert stub_qdrant.await_count == 2
