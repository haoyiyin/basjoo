"""Qdrant collection dimension guard.

`ensure_collection(kb_id, dimension)` takes the MEASURED vector width. It creates a
collection when none exists, is idempotent for the same width, and refuses to
silently reuse a collection whose width differs (that refusal is what forces the
reset path to delete-then-recreate).

No live Qdrant: the client is a recorded fake installed via monkeypatch.
"""

from types import SimpleNamespace

import pytest

from services import qdrant_service
from services.qdrant_service import QdrantKbService, get_kb_collection_name

class FakeAsyncQdrantClient:
    """Minimal stand-in that records every collection call."""

    def __init__(self, existing: dict[str, int] | None = None):
        self.collections: dict[str, int] = dict(existing or {})
        self.calls: list[tuple] = []

    async def get_collection(self, collection_name):
        self.calls.append(("get", collection_name))
        size = self.collections.get(collection_name)
        if size is None:
            raise RuntimeError(f"Collection {collection_name} not found")
        return SimpleNamespace(
            config=SimpleNamespace(
                params=SimpleNamespace(vectors=SimpleNamespace(size=size))
            )
        )

    async def create_collection(self, collection_name, vectors_config):
        self.calls.append(("create", collection_name, vectors_config.size))
        self.collections[collection_name] = vectors_config.size

    async def delete_collection(self, collection_name):
        self.calls.append(("delete", collection_name))
        if collection_name not in self.collections:
            raise RuntimeError(f"Collection {collection_name} not found")
        del self.collections[collection_name]

def _install_fake_client(monkeypatch, client: FakeAsyncQdrantClient) -> FakeAsyncQdrantClient:
    def fake_init(self):
        object.__setattr__(self, "client", client)

    monkeypatch.setattr(qdrant_service.QdrantKbService, "__init__", fake_init)
    return client

def _create_calls(client: FakeAsyncQdrantClient) -> list[tuple]:
    return [call for call in client.calls if call[0] == "create"]

def test_ensure_collection_creates_then_is_idempotent(monkeypatch):
    client = _install_fake_client(monkeypatch, FakeAsyncQdrantClient())
    service = QdrantKbService()
    kb_id = "11111111-2222-3333-4444-555555555555"
    name = get_kb_collection_name(kb_id)

    first = asyncio_run(service.ensure_collection(kb_id, 1024))
    assert first == name
    assert client.collections == {name: 1024}
    assert _create_calls(client) == [("create", name, 1024)]

    second = asyncio_run(service.ensure_collection(kb_id, 1024))
    assert second == name
    # Same width again: no second create_collection call.
    assert _create_calls(client) == [("create", name, 1024)]

def test_ensure_collection_refuses_mismatched_dimension(monkeypatch):
    client = _install_fake_client(monkeypatch, FakeAsyncQdrantClient())
    service = QdrantKbService()
    kb_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    name = get_kb_collection_name(kb_id)

    asyncio_run(service.ensure_collection(kb_id, 1024))

    with pytest.raises(RuntimeError) as exc_info:
        asyncio_run(service.ensure_collection(kb_id, 768))

    message = str(exc_info.value)
    assert name in message
    assert "1024" in message
    assert "768" in message
    assert "reset" in message
    # The refusal must not have recreated anything.
    assert client.collections == {name: 1024}
    assert _create_calls(client) == [("create", name, 1024)]

def test_delete_then_ensure_recreates_at_new_dimension(monkeypatch):
    client = _install_fake_client(monkeypatch, FakeAsyncQdrantClient())
    service = QdrantKbService()
    kb_id = "99999999-8888-7777-6666-555555555555"
    name = get_kb_collection_name(kb_id)

    asyncio_run(service.ensure_collection(kb_id, 1024))
    assert asyncio_run(service.delete_collection(kb_id)) is True
    assert name not in client.collections

    asyncio_run(service.ensure_collection(kb_id, 768))

    assert client.collections == {name: 768}
    assert _create_calls(client) == [("create", name, 1024), ("create", name, 768)]

def test_ensure_collection_recovers_when_get_collection_fails(monkeypatch):
    """An unreachable get_collection must fall through to create, not explode."""
    client = _install_fake_client(monkeypatch, FakeAsyncQdrantClient())
    service = QdrantKbService()

    async def boom(collection_name):
        raise ConnectionError("qdrant down")

    monkeypatch.setattr(client, "get_collection", boom)

    asyncio_run(service.ensure_collection("deadbeef-0000-0000-0000-000000000000", 1024))

    assert _create_calls(client) == [
        ("create", get_kb_collection_name("deadbeef-0000-0000-0000-000000000000"), 1024)
    ]

def test_get_embedding_dimension_is_migration_only_mapping():
    """Kept for the migration backfill; live paths pass a measured width."""
    assert qdrant_service.get_embedding_dimension("BAAI/bge-m3") == 1024
    assert qdrant_service.get_embedding_dimension("bge_m3") == 1024
    assert qdrant_service.get_embedding_dimension("jina-embeddings-v3") == 1024
    assert qdrant_service.get_embedding_dimension("jina-embeddings-v2-base-en") == 768
    assert qdrant_service.get_embedding_dimension("text-embedding-3-large") == 3072
    assert qdrant_service.get_embedding_dimension("text-embedding-3-small") == 1536
    assert qdrant_service.get_embedding_dimension("ada-002") == 1536
    # Self-hosted granite-embedding-97m is 384 dimensional.
    assert (
        qdrant_service.get_embedding_dimension(
            "ibm-granite/granite-embedding-97m-multilingual-r2"
        )
        == 384
    )
    assert qdrant_service.get_embedding_dimension("something-unknown") == 1024

# ---- tiny asyncio helper ---------------------------------------------------
# These tests are deliberately synchronous (no DB fixture, no event-loop fixture
# coupling) so they stay fast and hermetic.

def asyncio_run(coro):
    import asyncio

    return asyncio.run(coro)
