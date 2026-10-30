"""#41 — the transcript email: exactly once, plain text, 503 when unconfigured.

The guard is `UPDATE chat_sessions SET transcript_sent_at = now
WHERE transcript_sent_at IS NULL`, so these tests assert the database outcome
("one send happened") rather than trusting the route to behave. The SMTP
conversation is replaced by a recorder, so nothing leaves the test process, and
the recorder's call count *is* the number of emails sent.
"""

import email
import pytest
from sqlalchemy import select

import database
from services import transcript_service


def _same_instant(left: str, right: str) -> bool:
    """Compare two ISO timestamps as instants, ignoring tz suffix spelling."""
    from datetime import datetime, timezone

    def _parse(value: str) -> datetime:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    return _parse(left) == _parse(right)

class Recorder:
    """Stands in for the SMTP conversation; counts what would be sent."""

    def __init__(self):
        self.sent = []

    async def __call__(self, *, recipient, subject, body):
        self.sent.append({"recipient": recipient, "subject": subject, "body": body})

@pytest.fixture()
def smtp_configured(monkeypatch):
    """A configured-looking environment plus a recording sender."""
    for name, value in {
        "smtp_host": "smtp.example.com",
        "smtp_port": "587",
        "smtp_user": "mailer@example.com",
        "smtp_password": "hunter2",
        "smtp_from": "Basjoo <no-reply@example.com>",
        "smtp_use_tls": "true",
    }.items():
        monkeypatch.setattr(transcript_service.settings, name, value, raising=False)

    recorder = Recorder()
    monkeypatch.setattr(
        "api.v1.endpoints.send_transcript_email", recorder, raising=True
    )
    return recorder

@pytest.fixture()
def smtp_unconfigured(monkeypatch):
    for name in ("smtp_host", "smtp_user", "smtp_password", "smtp_from"):
        monkeypatch.setattr(transcript_service.settings, name, "", raising=False)
    monkeypatch.setattr(transcript_service.settings, "smtp_port", "587", raising=False)

    async def _explode(**_kwargs):
        raise AssertionError("Nothing may be sent when SMTP is unconfigured")

    monkeypatch.setattr("api.v1.endpoints.send_transcript_email", _explode)

async def _agent_id() -> str:
    from models import Agent

    async with database.AsyncSessionLocal() as session:
        agent = (
            await session.execute(
                select(Agent).where(Agent.is_active).order_by(Agent.created_at)
            )
        ).scalars().first()
        assert agent is not None
        return agent.id

async def _session_with_contact(agent_id: str, email_address="visitor@example.com"):
    """A real session with a contact email and two turns on it.

    Returns the **internal** id, because every `/admin/sessions/{id}/…` route
    addresses rows by primary key rather than by the widget's public id.
    """
    from httpx import ASGITransport, AsyncClient

    from main import app
    from models import ChatMessage, ChatSession

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        first = await ac.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": "How much is the pro plan?"},
        )
        assert first.status_code == 200, first.text
        public_id = first.json()["session_id"]
        second = await ac.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "And does it include support?",
                "session_id": public_id,
            },
        )
        assert second.status_code == 200, second.text

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == public_id)
        )
        session.contact_email = email_address
        session.contact_name = "Dana Visitor"
        await db.commit()
        assert (
            await db.scalar(
                select(ChatMessage.id).where(ChatMessage.session_id == session.id)
            )
        )
        return session.id

@pytest.mark.asyncio(loop_scope="function")
async def test_transcript_is_sent_once(client, smtp_configured):
    agent_id = await _agent_id()
    session_id = await _session_with_contact(agent_id)

    first = await client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["sent"] is True
    assert body["already_sent"] is False
    assert body["recipient"] == "visitor@example.com"
    assert body["sent_at"] is not None
    assert len(smtp_configured.sent) == 1

    # The second call is a no-op with a stable, successful body: a button that
    # is clicked twice must not error and must not send twice.
    second = await client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")
    assert second.status_code == 200, second.text
    again = second.json()
    assert again["sent"] is False
    assert again["already_sent"] is True
    assert again["recipient"] == "visitor@example.com"
    # Same instant, not necessarily the same string: the first response is
    # Pydantic-formatted, the second comes from the DB column.
    assert _same_instant(again["sent_at"], body["sent_at"])
    assert len(smtp_configured.sent) == 1

@pytest.mark.asyncio(loop_scope="function")
async def test_concurrent_attempts_send_once(client, smtp_configured):
    """The guard is in the database, so racing callers cannot both send."""
    import asyncio

    agent_id = await _agent_id()
    session_id = await _session_with_contact(agent_id)

    responses = await asyncio.gather(
        *[
            client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")
            for _ in range(5)
        ]
    )
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert len(smtp_configured.sent) == 1
    sent_flags = [r.json()["sent"] for r in responses]
    assert sent_flags.count(True) == 1
    assert sent_flags.count(False) == 4

@pytest.mark.asyncio(loop_scope="function")
async def test_unconfigured_smtp_is_503_not_500(client, smtp_unconfigured):
    agent_id = await _agent_id()
    session_id = await _session_with_contact(agent_id)

    response = await client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")
    assert response.status_code == 503, response.text
    assert "SMTP" in response.text

    # The session is still emailable: a 503 must not burn the only attempt.
    from models import ChatSession

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.id == session_id)
        )
        assert session.transcript_sent_at is None

@pytest.mark.asyncio(loop_scope="function")
async def test_failed_send_releases_the_claim(client, smtp_configured, monkeypatch):
    """A refused mail must be retryable, not permanently "already sent"."""
    agent_id = await _agent_id()
    session_id = await _session_with_contact(agent_id)

    async def _fail(**_kwargs):
        raise transcript_service.TranscriptSendFailed("550 mailbox unavailable")

    monkeypatch.setattr("api.v1.endpoints.send_transcript_email", _fail)
    failed = await client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")
    assert failed.status_code == 502, failed.text

    from models import ChatSession

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.id == session_id)
        )
        assert session.transcript_sent_at is None

    # And the retry, with a working sender, succeeds.
    monkeypatch.setattr("api.v1.endpoints.send_transcript_email", smtp_configured)
    retried = await client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")
    assert retried.status_code == 200, retried.text
    assert retried.json()["sent"] is True
    assert len(smtp_configured.sent) == 1

@pytest.mark.asyncio(loop_scope="function")
async def test_session_without_contact_email_is_409(client, smtp_configured):
    from httpx import ASGITransport, AsyncClient

    from main import app

    agent_id = await _agent_id()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/api/v1/chat", json={"agent_id": agent_id, "message": "hello"}
        )
    from models import ChatSession

    async with database.AsyncSessionLocal() as db:
        internal_id = await db.scalar(
            select(ChatSession.id).where(
                ChatSession.session_id == response.json()["session_id"]
            )
        )
    result = await client.post(f"/api/v1/admin/sessions/{internal_id}/email-transcript")
    assert result.status_code == 409, result.text
    assert len(smtp_configured.sent) == 0

@pytest.mark.asyncio(loop_scope="function")
async def test_unknown_session_is_404(client, smtp_configured):
    response = await client.post(
        "/api/v1/admin/sessions/sess_nope/email-transcript"
    )
    assert response.status_code == 404

@pytest.mark.asyncio(loop_scope="function")
async def test_transcript_requires_operator_auth(public_client, smtp_configured):
    agent_id = await _agent_id()
    session_id = await _session_with_contact(agent_id)
    response = await public_client.post(
        f"/api/v1/admin/sessions/{session_id}/email-transcript"
    )
    assert response.status_code in (401, 403)
    assert len(smtp_configured.sent) == 0

@pytest.mark.asyncio(loop_scope="function")
async def test_body_is_plain_text_and_carries_the_transcript(client, smtp_configured):
    """Plain text, both sides of the conversation, no HTML part."""
    from models import ChatSession

    agent_id = await _agent_id()
    session_id = await _session_with_contact(agent_id)
    await client.post(f"/api/v1/admin/sessions/{session_id}/email-transcript")

    async with database.AsyncSessionLocal() as db:
        public_id = await db.scalar(
            select(ChatSession.session_id).where(ChatSession.id == session_id)
        )
    sent = smtp_configured.sent[0]
    assert "How much is the pro plan?" in sent["body"]
    assert "And does it include support?" in sent["body"]
    # The transcript names the *public* session id — the one the visitor sees —
    # not the internal primary key.
    assert public_id in sent["body"]
    assert public_id in sent["subject"]
    assert "<html>" not in sent["body"].lower()
    assert "<div" not in sent["body"].lower()

def test_build_email_is_a_single_plain_text_part(monkeypatch):
    """`build_email` sets `text/plain` and nothing else — no multipart."""
    for name, value in {
        "smtp_host": "smtp.example.com",
        "smtp_port": "587",
        "smtp_user": "",
        "smtp_password": "",
        "smtp_from": "no-reply@example.com",
        "smtp_use_tls": "true",
    }.items():
        monkeypatch.setattr(transcript_service.settings, name, value, raising=False)

    smtp = transcript_service.load_smtp_settings()
    message = transcript_service.build_email(
        smtp, recipient="visitor@example.com", subject="Hi", body="line one\nline two"
    )
    assert message.get_content_type() == "text/plain"
    assert not message.is_multipart()
    assert message["To"] == "visitor@example.com"

    parsed = email.message_from_string(message.as_string())
    assert parsed.get_payload().strip() == "line one\nline two"

def test_render_transcript_labels_both_sides():
    """Pure rendering: the body says who said what, including the operator."""
    class _Msg:
        def __init__(self, role, content, sender_type=None, created_at=None):
            self.role = role
            self.content = content
            self.sender_type = sender_type
            self.created_at = created_at

    body = transcript_service.render_transcript(
        agent_name="Acme Bot",
        session_public_id="sess_acme_1",
        messages=[
            _Msg("user", "What is the price?"),
            _Msg("assistant", "It is $10."),
            _Msg("user", "Can a human confirm?"),
            _Msg("assistant", "Yes, I am the operator.", sender_type="human"),
        ],
        contact_name="Dana",
    )
    assert "Acme Bot — conversation transcript" in body
    assert "sess_acme_1" in body
    assert "Dana: What is the price?" in body
    assert "Acme Bot: It is $10." in body
    assert "Operator: Yes, I am the operator." in body
    assert "<" not in body.replace("—", "")

def test_render_transcript_handles_an_empty_session():
    body = transcript_service.render_transcript(
        agent_name=None, session_public_id="sess_x", messages=[]
    )
    assert "(no messages)" in body
    assert "sess_x" in body

def test_smtp_settings_defaults_and_tls_flag(monkeypatch):
    """`SMTP_USE_TLS` false-ish spellings all mean STARTTLS off."""
    for value, expected in [
        ("true", True),
        ("1", True),
        ("yes", True),
        ("false", False),
        ("0", False),
        ("no", False),
        ("off", False),
    ]:
        monkeypatch.setattr(transcript_service.settings, "smtp_host", "h", raising=False)
        monkeypatch.setattr(transcript_service.settings, "smtp_from", "f@x.com", raising=False)
        monkeypatch.setattr(
            transcript_service.settings, "smtp_use_tls", value, raising=False
        )
        assert transcript_service.load_smtp_settings().use_tls is expected

def test_sender_falls_back_to_user(monkeypatch):
    monkeypatch.setattr(transcript_service.settings, "smtp_host", "h", raising=False)
    monkeypatch.setattr(transcript_service.settings, "smtp_user", "u@x.com", raising=False)
    monkeypatch.setattr(transcript_service.settings, "smtp_from", "", raising=False)
    assert transcript_service.load_smtp_settings().sender == "u@x.com"
