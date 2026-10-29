"""Shared fakes for the #39 Q&A tests (not collected: no ``test_`` prefix).

The Q&A index is a real Qdrant collection in production. Tests replace the
`QdrantKbService` Q&A methods with an in-memory cosine index so the prompt
assertions are hermetic and deterministic while still exercising the real
`QaService` (embed → upsert → search → threshold → payload) code path.
"""

from __future__ import annotations

import math

import pytest
from starlette.requests import Request

from services import qdrant_service

def make_http_request(path: str = "/api/v1/chat/stream") -> Request:
    """A minimal real Starlette request (no MagicMock header surprises)."""
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(b"user-agent", b"pytest")],
            "client": ("127.0.0.1", 41000),
            "server": ("testserver", 80),
        }
    )

def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)

class FakeQaIndex:
    """An in-memory stand-in for the `qa_<hex>` collection."""

    def __init__(self, score: float | None = None):
        # (kb_id, qa_id) -> {"vector": [...], "payload": {...}}
        self.points: dict[tuple[str, str], dict] = {}
        self.deleted: list[tuple[str, str]] = []
        self.payload_updates: list[tuple[str, str]] = []
        self.ensured: list[tuple[str, int]] = []
        # When set, every hit reports this score instead of the real cosine.
        self.forced_score = score

    def install(self, monkeypatch) -> "FakeQaIndex":
        async def ensure_qa_collection(self_, kb_id, dimension):
            self.ensured.append((kb_id, int(dimension)))
            return f"qa_{kb_id.replace('-', '')[:12]}"

        async def upsert_qa_point(self_, kb_id, qa_id, vector, payload):
            self.points[(kb_id, qa_id)] = {
                "vector": list(vector),
                "payload": dict(payload),
            }

        async def set_qa_payload(self_, kb_id, qa_id, payload):
            key = (kb_id, qa_id)
            if key not in self.points:
                return False
            self.points[key]["payload"] = dict(payload)
            self.payload_updates.append(key)
            return True

        async def delete_qa_point(self_, kb_id, qa_id):
            self.deleted.append((kb_id, qa_id))
            self.points.pop((kb_id, qa_id), None)
            return True

        async def search_qa(self_, kb_id, query_vector, top_k=3):
            hits = []
            for (point_kb, qa_id), point in self.points.items():
                if point_kb != kb_id:
                    continue
                score = (
                    self.forced_score
                    if self.forced_score is not None
                    else _cosine(query_vector, point["vector"])
                )
                hits.append(
                    {"id": qa_id, "score": score, "payload": dict(point["payload"])}
                )
            hits.sort(key=lambda hit: hit["score"], reverse=True)
            return hits[:top_k]

        monkeypatch.setattr(
            qdrant_service.QdrantKbService, "ensure_qa_collection", ensure_qa_collection
        )
        monkeypatch.setattr(
            qdrant_service.QdrantKbService, "upsert_qa_point", upsert_qa_point
        )
        monkeypatch.setattr(
            qdrant_service.QdrantKbService, "set_qa_payload", set_qa_payload
        )
        monkeypatch.setattr(
            qdrant_service.QdrantKbService, "delete_qa_point", delete_qa_point
        )
        monkeypatch.setattr(qdrant_service.QdrantKbService, "search_qa", search_qa)
        return self

class RecordingEmbeddings:
    """Deterministic embeddings that record every provider round trip.

    Every text maps to the same unit vector so a search always matches what was
    indexed; the call count is what the re-embedding test asserts on.
    """

    def __init__(self, dimension: int = 4):
        self.dimension = dimension
        self.calls: list[list[str]] = []

    async def __call__(self, kb, texts):
        self.calls.append(list(texts))
        return [[1.0] + [0.0] * (self.dimension - 1) for _ in texts]

    @property
    def call_count(self) -> int:
        return len(self.calls)

    def install(self, monkeypatch) -> "RecordingEmbeddings":
        monkeypatch.setattr("services.qa_service.embed_qa_texts", self)
        return self

@pytest.fixture
def fake_qa_index(monkeypatch):
    return FakeQaIndex().install(monkeypatch)

@pytest.fixture
def recording_embeddings(monkeypatch):
    return RecordingEmbeddings().install(monkeypatch)
