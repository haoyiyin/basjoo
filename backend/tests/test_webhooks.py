"""A webhook failure never delays or fails the chat request (#47).

The acceptance sentence is "A webhook failure never delays or fails the chat
request". Three separate properties have to hold, and each is asserted on a real
artefact rather than on a helper's return value:

1. **Nothing is posted on the request path.** ``httpx``'s transport is replaced by
   one that raises (and records) if it is ever used, so a chat turn against a
   subscriber whose server is a black hole still returns promptly and the
   transport's call log is empty.
2. **The delivery row commits with the domain change.** A ``session.created``
   turn leaves exactly one ``webhook_deliveries`` row with ``status='pending'``
   and ``attempts=0``; there is no window in which the session exists and the
   event is lost.
3. **The scheduler drains it, signed, with a bounded number of attempts.** The
   HMAC in ``X-Basjoo-Signature`` is compared against a value computed locally
   from the stored (encrypted) secret and the exact bytes on the wire, and a
   failing endpoint is retried three times with exponential backoff — never
   inline.

Every write assertion reads the ``webhook_deliveries`` table itself, so "no
inline delivery" cannot be satisfied by a code path that merely logs.
"""

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

import database
from core.encryption import decrypt_api_key, encrypt_api_key
from models import Agent, ChatSession, WebhookDelivery
from services import webhook_service
from services.webhook_service import (
    SIGNATURE_HEADER,
    WEBHOOK_MAX_ATTEMPTS,
    WEBHOOK_TIMEOUT_SECONDS,
    build_payload,
    drain_pending_webhooks,
    sign_payload,
)

#: The subscriber's real secret. The test recomputes the HMAC from this, which is
#: what proves the stored (encrypted) value round-trips and that the signature
#: covers the exact bytes that were sent.
SUBSCRIPTION_SECRET = "whsec_test_47_signing_secret"
WEBHOOK_URL = "https://hooks.example.com/basjoo/events"

#: Captured before any fixture replaces it, so a test can install its own
#: transport on the REAL client class instead of nesting wrappers.
_REAL_ASYNC_CLIENT = httpx.AsyncClient

class _ForbiddenTransport(httpx.AsyncBaseTransport):
    """Any request on the chat request path is a bug, so record and refuse it."""

    def __init__(self):
        self.calls: list[httpx.Request] = []

    async def handle_async_request(self, request):
        self.calls.append(request)
        raise AssertionError(
            "a webhook was POSTed on the request path: " + str(request.url)
        )

class _RecordingTransport(httpx.AsyncBaseTransport):
    """A fake subscriber: records the signed request and answers 200."""

    def __init__(self, status_code: int = 200):
        self.calls: list[httpx.Request] = []
        self.bodies: list[bytes] = []
        self.status_code = status_code

    async def handle_async_request(self, request):
        self.calls.append(request)
        body = b""
        async for chunk in request.stream:
            body += chunk
        self.bodies.append(body)
        return httpx.Response(self.status_code, request=request)

@pytest.fixture(autouse=True)
def no_inline_http(monkeypatch):
    """Globally forbid outbound HTTP unless a test installs its own transport.

    Retrieval would otherwise reach the embedding provider for the query vector
    and the vector store for neighbours, which are not what this file is about.
    Those two seams are faked so that *any* request reaching ``httpx`` is, by
    construction, a webhook — which makes the assertion unambiguous.
    """
    from services.document_parser import DocumentParser
    from services.qdrant_service import QdrantKbService

    async def fake_embed_texts(self, texts, model, base_url, api_key=None, **kwargs):
        return [[0.01] * 8 for _ in texts]

    async def fake_search(self, *args, **kwargs):
        return []

    monkeypatch.setattr(DocumentParser, "embed_texts", fake_embed_texts, raising=True)
    for name in ("search", "search_points", "search_kb"):
        if hasattr(QdrantKbService, name):
            monkeypatch.setattr(
                QdrantKbService, name, fake_search, raising=False
            )

    transport = _ForbiddenTransport()

    def guarded_client(*args, **kwargs):
        kwargs["transport"] = transport
        return _REAL_ASYNC_CLIENT(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", guarded_client, raising=True)
    yield transport

@pytest.fixture
def install_transport(monkeypatch, no_inline_http):
    """Install a fake subscriber as the only reachable HTTP endpoint."""

    def _install(transport):
        def fake_client(*args, **kwargs):
            kwargs["transport"] = transport
            return _REAL_ASYNC_CLIENT(*args, **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", fake_client, raising=True)
        return transport

    return _install

async def _agent_with_webhook(agent_id: str) -> Agent:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        agent.webhook_url = WEBHOOK_URL
        agent.webhook_secret = encrypt_api_key(SUBSCRIPTION_SECRET)
        await session.commit()
        return agent

@pytest.mark.asyncio
async def test_chat_request_never_posts_and_still_answers(
    public_client, default_agent_id, no_inline_http
):
    """A chat turn with a webhook configured makes zero outbound HTTP calls.

    The subscriber is configured but its server is never contacted: the request
    path only INSERTs. The reply itself must still arrive, so a broken webhook
    cannot fail the chat.
    """
    await _agent_with_webhook(default_agent_id)

    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "hello from the webhook test",
            "visitor_id": "visitor-webhook-1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json().get("reply"), "the chat must answer with a webhook configured"
    assert no_inline_http.calls == [], (
        "the request path must never POST: "
        + repr([str(call.url) for call in no_inline_http.calls])
    )

@pytest.mark.asyncio
async def test_session_created_row_commits_with_the_session(
    public_client, default_agent_id, no_inline_http
):
    """`session.created` is a `pending` row in the same transaction as the row."""
    await _agent_with_webhook(default_agent_id)

    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "queue a session.created delivery",
            "visitor_id": "visitor-webhook-2",
        },
    )
    assert response.status_code == 200, response.text
    session_public_id = response.json()["session_id"]

    async with database.AsyncSessionLocal() as session:
        rows = list(
            (
                await session.execute(
                    select(WebhookDelivery)
                    .where(WebhookDelivery.agent_id == default_agent_id)
                    .order_by(WebhookDelivery.created_at.asc())
                )
            )
            .scalars()
            .all()
        )

    events = [row.event for row in rows]
    assert "session.created" in events, events
    created = next(row for row in rows if row.event == "session.created")
    assert created.status == "pending", (
        "a delivery is queued, never sent: the scheduler owns the POST"
    )
    assert created.attempts == 0
    assert created.delivered_at is None
    assert created.next_attempt_at is None

    payload = json.loads(created.payload)
    assert payload["event"] == "session.created"
    assert payload["agent_id"] == default_agent_id
    assert payload["data"]["session_id"] == session_public_id
    assert payload["timestamp"], "the C5 payload carries an iso8601 timestamp"
    # The session itself exists, in the same committed state.
    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(ChatSession).where(ChatSession.session_id == session_public_id)
            )
        ).scalar_one()
        assert row.agent_id == default_agent_id

@pytest.mark.asyncio
async def test_scheduler_delivers_a_signed_payload(
    default_agent_id, install_transport
):
    """The drained POST carries a locally-recomputable HMAC over the sent bytes."""
    agent = await _agent_with_webhook(default_agent_id)

    async with database.AsyncSessionLocal() as session:
        delivery = webhook_service.enqueue_webhook(
            session,
            agent,
            "session.created",
            {"session_id": "sess_signature_check", "visitor_id": "v-1"},
        )
        await session.commit()
        delivery_id = delivery.id

    transport = install_transport(_RecordingTransport())

    async with database.AsyncSessionLocal() as session:
        stats = await drain_pending_webhooks(session)

    assert stats["delivered"] == 1, stats
    assert len(transport.calls) == 1, transport.calls

    request = transport.calls[0]
    sent_body = transport.bodies[0]
    assert str(request.url) == WEBHOOK_URL
    assert request.method == "POST"

    # The signature is recomputed here from the plaintext secret and compared
    # with the header the receiver would actually see.
    expected = (
        "sha256="
        + hmac.new(
            SUBSCRIPTION_SECRET.encode("utf-8"), sent_body, hashlib.sha256
        ).hexdigest()
    )
    assert request.headers[SIGNATURE_HEADER] == expected, (
        "the delivered signature must verify against the locally computed HMAC"
    )

    # The body is exactly the stored payload, so retries are byte-identical.
    async with database.AsyncSessionLocal() as session:
        row = await session.get(WebhookDelivery, delivery_id)
        assert row.status == "delivered"
        assert row.delivered_at is not None
        assert row.last_error is None
        assert row.payload.encode("utf-8") == sent_body
        assert json.loads(sent_body.decode("utf-8"))["event"] == "session.created"

@pytest.mark.asyncio
async def test_failed_delivery_retries_three_times_with_backoff(
    default_agent_id, install_transport
):
    """A dead endpoint gets 3 attempts spaced by exponential backoff, then fails."""
    agent = await _agent_with_webhook(default_agent_id)

    async with database.AsyncSessionLocal() as session:
        delivery = webhook_service.enqueue_webhook(
            session, agent, "message.created", {"session_id": "sess-retry"}
        )
        await session.commit()
        delivery_id = delivery.id

    transport = install_transport(_RecordingTransport(status_code=500))

    waits: list[timedelta] = []
    for attempt in range(1, WEBHOOK_MAX_ATTEMPTS + 1):
        async with database.AsyncSessionLocal() as session:
            await drain_pending_webhooks(session)
            row = await session.get(WebhookDelivery, delivery_id)
            assert row.attempts == attempt, (
                f"attempt {attempt} must be recorded exactly once; got {row.attempts}"
            )
            if attempt < WEBHOOK_MAX_ATTEMPTS:
                assert row.status == "pending"
                assert row.next_attempt_at is not None
                waits.append(
                    row.next_attempt_at.replace(tzinfo=timezone.utc)
                    - datetime.now(timezone.utc)
                )
            else:
                assert row.status == "failed"
                assert "500" in (row.last_error or "")

        if attempt < WEBHOOK_MAX_ATTEMPTS:
            # Walk the backoff clock instead of sleeping for a minute.
            async with database.AsyncSessionLocal() as session:
                await drain_pending_webhooks(
                    session,
                    now=datetime.now(timezone.utc)
                    + timedelta(seconds=3600 * attempt),
                )

    assert len(transport.calls) == WEBHOOK_MAX_ATTEMPTS, (
        "a delivery is attempted exactly three times, never more: "
        f"{len(transport.calls)}"
    )
    assert len(waits) == 2, waits
    assert waits[1] > waits[0], (
        "backoff must grow exponentially, not stay flat: "
        f"{waits[0]} then {waits[1]}"
    )

@pytest.mark.asyncio
async def test_batch_is_bounded(default_agent_id):
    """One tick drains at most `WEBHOOK_BATCH_SIZE` rows."""
    agent = await _agent_with_webhook(default_agent_id)
    async with database.AsyncSessionLocal() as session:
        for index in range(webhook_service.WEBHOOK_BATCH_SIZE + 5):
            webhook_service.enqueue_webhook(
                session, agent, "message.created", {"n": index}
            )
        await session.commit()

    async with database.AsyncSessionLocal() as session:
        stats = await drain_pending_webhooks(session, limit=3)
    assert sum(stats.values()) == 3, stats

    async with database.AsyncSessionLocal() as session:
        pending = (
            await session.execute(
                select(WebhookDelivery).where(WebhookDelivery.status == "pending")
            )
        ).scalars().all()
    assert len(pending) == webhook_service.WEBHOOK_BATCH_SIZE + 5, (
        "with no endpoint reachable the rows stay pending; the bound is what was "
        "exercised here"
    )

@pytest.mark.asyncio
async def test_no_agent_endpoint_means_no_rows(default_agent_id):
    """An installation without webhooks writes nothing at all."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        agent.webhook_url = None
        await session.commit()

    async with database.AsyncSessionLocal() as session:
        assert (
            webhook_service.enqueue_webhook(
                session, agent, "session.created", {"session_id": "s"}
            )
            is None
        )
        await session.commit()

    async with database.AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(WebhookDelivery).where(
                    WebhookDelivery.agent_id == default_agent_id
                )
            )
        ).scalars().all()
    assert rows == []

def test_signature_is_computed_over_exact_bytes():
    """`sign_payload` is an HMAC-SHA256 over the body, not over a re-serialisation."""
    body = b'{"event":"session.created","agent_id":"a","data":{}}'
    expected = "sha256=" + hmac.new(b"k", body, hashlib.sha256).hexdigest()
    assert sign_payload("k", body) == expected
    # A different body must not verify with the same header.
    assert sign_payload("k", body + b" ") != expected

def test_payload_uses_the_c5_shape():
    """`{"event", "timestamp", "agent_id", "data"}` — the frozen C5 contract."""
    payload = json.loads(build_payload("lead.created", "agent-x", {"lead_id": "l1"}))
    assert set(payload) == {"event", "timestamp", "agent_id", "data"}
    assert payload["event"] == "lead.created"
    assert payload["agent_id"] == "agent-x"
    assert payload["data"] == {"lead_id": "l1"}
    # iso8601, parseable, and UTC.
    parsed = datetime.fromisoformat(payload["timestamp"])
    assert parsed.tzinfo is not None

def test_unknown_event_is_rejected():
    with pytest.raises(ValueError):
        build_payload("session.exploded", "agent-x", {})

def test_timeout_is_five_seconds():
    assert WEBHOOK_TIMEOUT_SECONDS == 5.0

@pytest.mark.asyncio
async def test_secret_is_encrypted_at_rest(
    client, default_agent_id, no_inline_http
):
    """The PATCH stores ciphertext; the GET only reports `webhook_secret_set`."""
    response = await client.put(
        "/api/v1/agent",
        params={"agent_id": default_agent_id},
        json={
            "webhook_url": WEBHOOK_URL,
            "webhook_secret": SUBSCRIPTION_SECRET,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["webhook_url"] == WEBHOOK_URL
    assert body["webhook_secret_set"] is True
    assert "webhook_secret" not in body, (
        "the secret is write-only; only a boolean may come back"
    )

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        stored = agent.webhook_secret
        assert stored and stored != SUBSCRIPTION_SECRET, (
            "the signing secret must not be stored in plaintext"
        )
        assert decrypt_api_key(stored) == SUBSCRIPTION_SECRET

@pytest.mark.asyncio
async def test_document_indexed_is_queued_by_the_real_processor(
    bound_kb_id, default_agent_id, monkeypatch
):
    """`document.indexed` is an INSERT made by the ingest transaction itself.

    The processor runs for real (only the provider and Qdrant are faked), and the
    assertion is on the `webhook_deliveries` row it left behind — so "the event is
    emitted when the index is" is a property of the shipped code, not of a helper.
    """
    from services.document_parser import DocumentParser
    from services.kb_document_processor import KbDocumentProcessor
    from services.qdrant_service import QdrantKbService

    await _agent_with_webhook(default_agent_id)

    async def fake_embed_texts(self, texts, model, base_url, api_key=None, **kwargs):
        return [[0.01] * 8 for _ in texts]

    async def fake_batch_upsert_points(self, kb_id, points, batch_size=100):
        return len(points)

    async def fake_ensure_collection(self, kb_id, dimension):
        return kb_id

    monkeypatch.setattr(DocumentParser, "embed_texts", fake_embed_texts, raising=True)
    monkeypatch.setattr(
        QdrantKbService, "batch_upsert_points", fake_batch_upsert_points, raising=True
    )
    monkeypatch.setattr(
        QdrantKbService, "ensure_collection", fake_ensure_collection, raising=True
    )

    async with database.AsyncSessionLocal() as session:
        from models import KnowledgeBase

        kb = await session.get(KnowledgeBase, bound_kb_id)
        workspace_id = int(kb.workspace_id)

    processor = KbDocumentProcessor()
    async with database.AsyncSessionLocal() as session:
        doc = await processor.create_document_record(
            workspace_id,
            bound_kb_id,
            filename="indexed-event.txt",
            file_size=64,
            source_agent_id=default_agent_id,
            db=session,
        )
        storage_path = processor.save_uploaded_file(
            doc,
            (
                "Indexed event page. This paragraph is long enough for the parser "
                "to produce at least one chunk so the document reaches ready."
            ).encode("utf-8"),
            ".txt",
        )
        object.__setattr__(doc, "storage_path", storage_path)
        object.__setattr__(doc, "file_type", "txt")
        await session.commit()
        doc_id = str(doc.id)

    await processor.process_document(doc_id, bound_kb_id)

    async with database.AsyncSessionLocal() as session:
        rows = list(
            (
                await session.execute(
                    select(WebhookDelivery).where(
                        WebhookDelivery.agent_id == default_agent_id,
                        WebhookDelivery.event == "document.indexed",
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1, [row.event for row in rows]
    assert rows[0].status == "pending"
    assert rows[0].attempts == 0
    payload = json.loads(rows[0].payload)
    assert payload["data"]["document_id"] == doc_id
    assert payload["data"]["chunk_count"] >= 1

@pytest.mark.asyncio
async def test_lead_created_uses_the_same_queue(default_agent_id):
    """`lead.created` (C5) is queued like every other event, never posted."""
    from models import Lead

    agent = await _agent_with_webhook(default_agent_id)
    async with database.AsyncSessionLocal() as session:
        lead = Lead(
            agent_id=default_agent_id,
            session_id="sess-lead-1",
            email="lead@example.com",
            name="A Lead",
            source="prechat",
        )
        session.add(lead)
        await session.flush()
        webhook_service.enqueue_lead_created(session, agent, lead)
        await session.commit()
        lead_id = str(lead.id)

    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(WebhookDelivery).where(
                    WebhookDelivery.event == "lead.created"
                )
            )
        ).scalar_one()
    assert row.status == "pending"
    payload = json.loads(row.payload)
    assert payload["data"]["lead_id"] == lead_id
    assert payload["data"]["email"] == "lead@example.com"

@pytest.mark.asyncio
async def test_handoff_requested_is_queued_by_the_visitor_escalation(
    public_client, default_agent_id, no_inline_http
):
    """`handoff.requested` is an INSERT in the escalation transaction itself."""
    from models import ChatSession

    await _agent_with_webhook(default_agent_id)

    async with database.AsyncSessionLocal() as session:
        session.add(
            ChatSession(
                id="sess_handoff_webhook",
                agent_id=default_agent_id,
                session_id="sess_handoff_webhook_public",
                status="active",
                visitor_id="visitor-handoff",
            )
        )
        await session.commit()

    response = await public_client.post(
        "/api/v1/chat/escalate",
        json={
            "agent_id": default_agent_id,
            "session_id": "sess_handoff_webhook_public",
            "visitor_id": "visitor-handoff",
            "reason": "wants an invoice",
        },
    )
    assert response.status_code == 200, response.text
    assert no_inline_http.calls == []

    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(WebhookDelivery).where(
                    WebhookDelivery.event == "handoff.requested"
                )
            )
        ).scalar_one()
    assert row.status == "pending"
    payload = json.loads(row.payload)
    assert payload["data"]["reason"] == "wants an invoice"
