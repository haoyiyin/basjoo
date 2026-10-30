"""Issue #46 — one-click visitor deletion, verified by row counts.

The acceptance box is *"Delete removes messages, sessions and leads (verified by
row counts)"*, so every test here counts rows in the database before and after
rather than trusting the response body. The fixture visitor is deliberately the
one the brief names: **2 sessions, 6 messages, 1 lead, 1 feedback row** — one
signed-in customer across two sessions on one agent, which is exactly the shape
a real GDPR request has.

The other three guarantees:

* a visit that exists only in another workspace answers 404 (same pattern as the
  handoff routes), and nothing of theirs is deleted;
* the response carries the counts, so the console can say "已删除 2 个会话、
  6 条消息" instead of a shrug;
* deletion is scoped to the visitor — a different visitor's rows on the same
  agent survive.
"""

import pytest
from sqlalchemy import func, select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession, Lead, Workspace, WorkspaceQuota

VISITOR = "delete-me@example.com:aaaa"
OTHER_VISITOR = "keep-me@example.com:bbbb"

# ---------------------------------------------------------------- fixtures

async def _counts() -> dict[str, int]:
    """Every row this feature can delete, counted on the real tables."""
    async with database.AsyncSessionLocal() as db:
        return {
            "sessions": int(
                await db.scalar(select(func.count(ChatSession.id))) or 0
            ),
            "messages": int(
                await db.scalar(select(func.count(ChatMessage.id))) or 0
            ),
            "leads": int(await db.scalar(select(func.count(Lead.id))) or 0),
            "rated_messages": int(
                await db.scalar(
                    select(func.count(ChatMessage.id)).where(
                        ChatMessage.rating.isnot(None), ChatMessage.rating != 0
                    )
                )
                or 0
            ),
        }

async def _seed_visitor(agent_id: str) -> dict[str, list[str]]:
    """2 sessions, 6 messages, 1 lead, 1 thumbs vote — plus a control visitor."""
    ids: dict[str, list[str]] = {"sessions": [], "kept_sessions": []}
    async with database.AsyncSessionLocal() as db:
        for index in range(2):
            session = ChatSession(
                agent_id=agent_id,
                session_id=f"sess_delete_{index}",
                visitor_id=VISITOR,
                status="closed",
            )
            db.add(session)
            await db.flush()
            ids["sessions"].append(session.id)
            for turn in range(3):
                message = ChatMessage(
                    session_id=session.id,
                    role="user" if turn % 2 == 0 else "assistant",
                    content=f"session {index} turn {turn}",
                )
                db.add(message)
                await db.flush()
                # The one vote rides on a visitor turn, exactly like thumbs-up
                # does in the widget (#41).
                if index == 0 and turn == 0:
                    message.rating = 1

        kept = ChatSession(
            agent_id=agent_id,
            session_id="sess_keep",
            visitor_id=OTHER_VISITOR,
            status="closed",
        )
        db.add(kept)
        await db.flush()
        ids["kept_sessions"].append(kept.id)
        db.add(
            ChatMessage(session_id=kept.id, role="user", content="someone else")
        )

        lead = Lead(
            agent_id=agent_id,
            session_id=ids["sessions"][0],
            email=VISITOR.split(":")[0],
            name="Ada",
            message="please delete my data",
            source="prechat",
        )
        db.add(lead)
        await db.commit()
    return ids

# ----------------------------------------------- the acceptance box: row counts

@pytest.mark.asyncio
async def test_delete_visitor_removes_exactly_the_visitors_rows(client, default_agent_id):
    """2 sessions / 6 messages / 1 lead / 1 feedback row go; the control stays."""
    ids = await _seed_visitor(default_agent_id)

    before = await _counts()
    assert before["sessions"] >= 3
    assert before["messages"] >= 7
    assert before["leads"] >= 1
    assert before["rated_messages"] >= 1

    response = await client.delete(f"/api/v1/admin/visitors/{VISITOR}")
    assert response.status_code == 200, response.text
    body = response.json()

    # The response reports the same numbers the tables lost.
    assert body["deleted"] == {
        "sessions": 2,
        "messages": 6,
        "leads": 1,
        "feedback": 1,
    }, body
    assert body["total"] == 10
    assert body["visitor_id"] == VISITOR

    after = await _counts()
    assert after["sessions"] == before["sessions"] - 2
    assert after["messages"] == before["messages"] - 6
    assert after["leads"] == before["leads"] - 1
    assert after["rated_messages"] == before["rated_messages"] - 1

    # The other visitor is untouched: sessions, messages and all.
    async with database.AsyncSessionLocal() as db:
        for session_id in ids["kept_sessions"]:
            assert await db.get(ChatSession, session_id) is not None
        kept_messages = await db.scalar(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.session_id.in_(ids["kept_sessions"])
            )
        )
        assert kept_messages == 1
        # No row anywhere still carries the deleted visitor's id.
        assert (
            await db.scalar(
                select(func.count(ChatSession.id)).where(
                    ChatSession.visitor_id == VISITOR
                )
            )
            == 0
        )
        assert (
            await db.scalar(select(func.count(Lead.id)).where(Lead.email == VISITOR.split(":")[0]))
            == 0
        )

@pytest.mark.asyncio
async def test_delete_is_idempotent_the_second_call_is_a_404(client, default_agent_id):
    """A second click cannot double-delete (or claim it deleted something)."""
    await _seed_visitor(default_agent_id)

    first = await client.delete(f"/api/v1/admin/visitors/{VISITOR}")
    assert first.status_code == 200, first.text

    second = await client.delete(f"/api/v1/admin/visitors/{VISITOR}")
    assert second.status_code == 404, second.text
    assert second.json()["detail"] == "Visitor not found"

# ------------------------------------------------------------ rejection paths

@pytest.mark.asyncio
async def test_cross_workspace_deletion_404s_and_deletes_nothing(client):
    """A visitor that only exists in another workspace answers 404, as the handoff routes do."""
    async with database.AsyncSessionLocal() as db:
        workspace = Workspace(name="Other WS 46", owner_email="ws46@example.com")
        db.add(workspace)
        await db.flush()
        db.add(WorkspaceQuota(workspace_id=workspace.id))
        agent = Agent(
            workspace_id=workspace.id,
            name="Foreign 46",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            identity_secret=encrypt_api_key("foreign-secret"),
        )
        db.add(agent)
        await db.flush()
        session = ChatSession(
            agent_id=agent.id,
            session_id="sess_foreign_46",
            visitor_id=VISITOR,
            status="closed",
        )
        db.add(session)
        await db.flush()
        db.add(
            ChatMessage(session_id=session.id, role="user", content="foreign data")
        )
        await db.commit()
        foreign_session_id = session.id

    before = await _counts()
    response = await client.delete(f"/api/v1/admin/visitors/{VISITOR}")
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Visitor not found"

    after = await _counts()
    assert after == before, "a foreign workspace's visitor must not be touched"

    async with database.AsyncSessionLocal() as db:
        assert await db.get(ChatSession, foreign_session_id) is not None

@pytest.mark.asyncio
async def test_unknown_visitor_is_404(client, default_agent_id):
    response = await client.delete("/api/v1/admin/visitors/visitor_nobody_ever")
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Visitor not found"

@pytest.mark.asyncio
async def test_deletion_requires_authentication(public_client, default_agent_id):
    await _seed_visitor(default_agent_id)
    response = await public_client.delete(f"/api/v1/admin/visitors/{VISITOR}")
    assert response.status_code in (401, 403), response.text

# ----------------------------------------------- signed identity: lead sweep

@pytest.mark.asyncio
async def test_signed_identity_also_sweeps_a_lead_without_a_session(
    client, default_agent_id
):
    """A lead captured before any session exists is still this visitor's data.

    The offline form (#41) writes a lead that may never gain a `session_id`, so
    session-linked deletion alone would leave it behind. For a *verified* signed
    identity the email is known, so the sweep reaches it too.
    """
    from services.visitor_identity import build_visitor_identity

    secret = "sweep-secret-46"
    async with database.AsyncSessionLocal() as db:
        agent = await db.get(Agent, default_agent_id)
        assert agent is not None
        agent.identity_secret = encrypt_api_key(secret)
        await db.commit()

    identity = build_visitor_identity(secret, "ada@example.com")

    async with database.AsyncSessionLocal() as db:
        session = ChatSession(
            agent_id=default_agent_id,
            session_id="sess_signed_46",
            visitor_id=identity,
            status="closed",
        )
        db.add(session)
        await db.flush()
        db.add(ChatMessage(session_id=session.id, role="user", content="hi"))
        db.add(
            Lead(
                agent_id=default_agent_id,
                session_id=None,
                email="ada@example.com",
                name="Ada",
                message="no session yet",
                source="offline-form",
            )
        )
        await db.commit()

    response = await client.delete(f"/api/v1/admin/visitors/{identity}")
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["leads"] == 1
    assert response.json()["deleted"]["sessions"] == 1

    async with database.AsyncSessionLocal() as db:
        assert (
            await db.scalar(
                select(func.count(Lead.id)).where(Lead.email == "ada@example.com")
            )
            == 0
        )

@pytest.mark.asyncio
async def test_shaped_identity_cannot_sweep_leads_when_the_agent_has_no_secret(
    client, default_agent_id
):
    """A *shaped* `email:digest` value proves nothing on an unsigned agent.

    `verify_visitor_identity` answers `True` for an agent with no secret because
    there is nothing to check — that is the "behave exactly as today" rule. But
    "nothing to verify" is not "this email is proven": if the lead sweep read
    the address out of such a value, anyone could POST a self-made
    `stranger@example.com:<64 hex>` and erase that stranger's leads. The sweep
    therefore requires a secret to actually be configured.
    """
    shaped = f"ada@example.com:{'a' * 64}"
    async with database.AsyncSessionLocal() as db:
        session = ChatSession(
            agent_id=default_agent_id,
            session_id="sess_shaped_46",
            visitor_id=shaped,
            status="closed",
        )
        db.add(session)
        await db.flush()
        db.add(ChatMessage(session_id=session.id, role="user", content="shaped"))
        db.add(
            Lead(
                agent_id=default_agent_id,
                session_id=None,
                email="ada@example.com",
                name="Bystander",
                source="offline-form",
            )
        )
        await db.commit()

    response = await client.delete(f"/api/v1/admin/visitors/{shaped}")
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["sessions"] == 1
    # The unlinked lead survives: no secret means no verified email.
    assert response.json()["deleted"]["leads"] == 0

    async with database.AsyncSessionLocal() as db:
        assert (
            await db.scalar(
                select(func.count(Lead.id)).where(Lead.email == "ada@example.com")
            )
            == 1
        )

@pytest.mark.asyncio
async def test_unsigned_visitor_does_not_sweep_leads_by_string_match(
    client, default_agent_id
):
    """An unverified id must never select rows by value.

    `visitor_id` for an anonymous visitor is browser-supplied. If deletion
    matched leads on it, somebody could pass a value that collides with an
    address and erase a stranger's lead — so only a *verified* identity sweeps
    by email.
    """
    async with database.AsyncSessionLocal() as db:
        session = ChatSession(
            agent_id=default_agent_id,
            session_id="sess_anon_46",
            visitor_id="ada@example.com",
            status="closed",
        )
        db.add(session)
        await db.flush()
        db.add(ChatMessage(session_id=session.id, role="user", content="anon"))
        # A lead whose email equals the anonymous visitor id, but on no session.
        db.add(
            Lead(
                agent_id=default_agent_id,
                session_id=None,
                email="ada@example.com",
                name="Not theirs",
                source="offline-form",
            )
        )
        await db.commit()

    # The agent has no identity secret, so `ada@example.com` is an opaque
    # browser id and no email may be derived from it.
    response = await client.delete("/api/v1/admin/visitors/ada@example.com")
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["sessions"] == 1
    assert response.json()["deleted"]["leads"] == 0

    async with database.AsyncSessionLocal() as db:
        assert (
            await db.scalar(
                select(func.count(Lead.id)).where(Lead.email == "ada@example.com")
            )
            == 1
        )
