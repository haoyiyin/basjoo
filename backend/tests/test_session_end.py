"""#75 — visitor End chat, and the two transcript fields that ride with it.

The visitor's own "we are done" signal is the interesting part: it must close the
row with `closed_by='visitor'`, it must survive the operator's reopen, and it
must reach the outcome classifier as a *different* fact than an idle-sweep close.

Also pinned here, because they are the same transcript surface:

* `GET /api/v1/chat/messages` carries `mode` (#70) so a reloaded `scripted` turn
  can hide the thumbs;
* `GET /api/v1/admin/sessions` carries `contact_name` / `contact_email` (#72) so
  the console header can name the visitor without a second request.
"""

import pytest
from sqlalchemy import select

import database
from models import ChatMessage, ChatSession

VISITOR = "visitor-end"

async def _conversation(public_client, agent_id: str, visitor_id: str = VISITOR):
    """One real turn, so the session exists and has a message."""
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "How do I cancel my subscription?",
            "visitor_id": visitor_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["session_id"]

async def _session_row(public_session_id: str) -> ChatSession:
    async with database.AsyncSessionLocal() as db:
        row = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == public_session_id)
        )
        assert row is not None, "the session must exist"
        return row

# ------------------------------------------------------------- the end route

@pytest.mark.asyncio(loop_scope="function")
async def test_visitor_end_chat_closes_the_row_and_records_who(
    public_client, default_agent_id
):
    """status='closed' + closed_by='visitor', echoed in the receipt."""
    public_id = await _conversation(public_client, default_agent_id)

    response = await public_client.post(
        "/api/v1/chat/session:end",
        json={
            "agent_id": default_agent_id,
            "session_id": public_id,
            "visitor_id": VISITOR,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["session_id"] == public_id
    assert body["status"] == "closed"
    assert body["closed_by"] == "visitor"

    row = await _session_row(public_id)
    assert row.status == "closed"
    assert row.closed_by == "visitor"

@pytest.mark.asyncio(loop_scope="function")
async def test_ending_someone_elses_session_is_the_same_404(
    public_client, default_agent_id
):
    """Ownership is enforced; a foreign session id is never confirmed."""
    public_id = await _conversation(public_client, default_agent_id)

    foreign = await public_client.post(
        "/api/v1/chat/session:end",
        json={
            "agent_id": default_agent_id,
            "session_id": public_id,
            "visitor_id": "someone-else",
        },
    )
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["detail"] == "Session not found"

    # ...and the row was not touched by the refused call.
    row = await _session_row(public_id)
    assert row.status != "closed"
    assert row.closed_by is None

@pytest.mark.asyncio(loop_scope="function")
async def test_end_chat_requires_the_three_identifiers(public_client, default_agent_id):
    response = await public_client.post(
        "/api/v1/chat/session:end", json={"agent_id": default_agent_id}
    )
    assert response.status_code == 400, response.text

@pytest.mark.asyncio(loop_scope="function")
async def test_operator_reopen_still_works_on_a_visitor_closed_session(
    client, public_client, default_agent_id
):
    """The operator's reopen is not blocked by the visitor's own close."""
    public_id = await _conversation(public_client, default_agent_id)
    ended = await public_client.post(
        "/api/v1/chat/session:end",
        json={
            "agent_id": default_agent_id,
            "session_id": public_id,
            "visitor_id": VISITOR,
        },
    )
    assert ended.status_code == 200, ended.text

    row = await _session_row(public_id)
    reopened = await client.post(f"/api/v1/admin/sessions/{row.id}/reopen")
    assert reopened.status_code == 200, reopened.text
    session = reopened.json()["session"]
    assert session["status"] == "active"
    assert session["mode"] == "ai"

# ------------------------------------------------ #70: mode on a reloaded transcript

@pytest.mark.asyncio(loop_scope="function")
async def test_chat_messages_carries_mode_for_a_reloaded_transcript(
    public_client, default_agent_id
):
    """Every turn carries `mode`, so the widget can hide thumbs on a scripted one."""
    public_id = await _conversation(public_client, default_agent_id)

    response = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": public_id, "visitor_id": VISITOR},
    )
    assert response.status_code == 200, response.text
    messages = response.json()
    assert messages, "the transcript must not be empty"
    for message in messages:
        assert "mode" in message, message
        assert message["mode"], "a NULL mode must read as 'ai', never empty"

    assistant = [m for m in messages if m["role"] == "assistant"]
    assert assistant
    assert assistant[0]["mode"] in {"ai", "scripted", "human", "rate_limited"}

@pytest.mark.asyncio(loop_scope="function")
async def test_a_scripted_turn_reports_its_mode_on_reload(
    public_client, default_agent_id
):
    """A persisted `scripted` answer is not disguised as `ai` on reload (#60/#70)."""
    public_id = await _conversation(public_client, default_agent_id)

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == public_id)
        )
        assistant = await db.scalar(
            select(ChatMessage)
            .where(ChatMessage.session_id == session.id, ChatMessage.role == "assistant")
            .order_by(ChatMessage.id.asc())
            .limit(1)
        )
        assistant.mode = "scripted"
        await db.commit()

    response = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": public_id, "visitor_id": VISITOR},
    )
    assert response.status_code == 200, response.text
    scripted = [m for m in response.json() if m["role"] == "assistant"]
    assert scripted[0]["mode"] == "scripted"

# ------------------------------------------- #72: contact identity on the list

@pytest.mark.asyncio(loop_scope="function")
async def test_admin_sessions_list_carries_the_prechat_contact(
    client, public_client, default_agent_id
):
    """The console header names the visitor from the list payload alone."""
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "Do you ship to Canada?",
            "visitor_id": "visitor-contact",
            "prechat": {"name": "Ada Lovelace", "email": "ada@example.com"},
        },
    )
    assert response.status_code == 200, response.text
    public_id = response.json()["session_id"]

    listing = await client.get(
        "/api/v1/admin/sessions",
        params={"agent_id": default_agent_id, "keyword": "visitor-contact"},
    )
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert items, listing.text
    item = next(row for row in items if row["session_id"] == public_id)
    assert item["contact_name"] == "Ada Lovelace"
    assert item["contact_email"] == "ada@example.com"

@pytest.mark.asyncio(loop_scope="function")
async def test_admin_sessions_list_contact_is_null_when_the_form_was_skipped(
    client, public_client, default_agent_id
):
    """The pairing guard: an absent contact is null, not a crash or an empty string."""
    public_id = await _conversation(public_client, default_agent_id, visitor_id="visitor-nocontact")

    listing = await client.get(
        "/api/v1/admin/sessions",
        params={"agent_id": default_agent_id, "keyword": "visitor-nocontact"},
    )
    assert listing.status_code == 200, listing.text
    item = next(row for row in listing.json()["items"] if row["session_id"] == public_id)
    assert item["contact_name"] is None
    assert item["contact_email"] is None

# ------------------------------------- #75: the `form` channel action follows prechat_mode

@pytest.mark.asyncio
async def test_form_action_tracks_prechat_mode():
    """`FORM_CONFIG_ATTRS` names the field that actually exists on the agent.

    A procedure step that needs a `form` is only runnable when the agent can
    collect one, and the switch for that is `prechat_mode` — `off` means no form
    is ever shown, `optional` / `required` mean one is.
    """
    from services.procedure_service import (
        FORM_CONFIG_ATTRS,
        available_channel_actions,
    )

    assert FORM_CONFIG_ATTRS == ("prechat_mode",)

    class _Agent:
        def __init__(self, mode):
            self.prechat_mode = mode

    assert available_channel_actions(_Agent("off")) == {"link"}
    assert available_channel_actions(_Agent(None)) == {"link"}
    assert available_channel_actions(_Agent("optional")) == {"link", "form"}
    assert available_channel_actions(_Agent("required")) == {"link", "form"}
    # An old row whose column is absent must not crash the chat path.
    assert available_channel_actions(object()) == {"link"}
