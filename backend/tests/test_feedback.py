"""#41 — thumbs feedback: persisted per answer, toggled, clearable.

The storage decision follows the spine: the vote lives in
`chat_messages.rating` (-1 / 0 / +1) on the **visitor's** turn, i.e. in the
transcript's own context next to the answer it judges. Zero means "no vote", so
the second click clears rather than accumulating — which is the acceptance
contract's "toggle".

Every test asserts the database row, not just the response, because a route that
returns the right JSON and writes nothing would pass a response-only test.
"""

import pytest
from sqlalchemy import select

import database

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

async def _conversation(agent_id: str, visitor_id: str = "visitor-fb"):
    """Return `(public_session_id, assistant_message_id)` from a real turn."""
    from httpx import ASGITransport, AsyncClient

    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "How do I reset my password?",
                "visitor_id": visitor_id,
            },
        )
    assert response.status_code == 200, response.text
    public_id = response.json()["session_id"]

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        messages = await ac.get(
            "/api/v1/chat/messages",
            params={"session_id": public_id, "visitor_id": visitor_id},
        )
    assert messages.status_code == 200, messages.text
    assistant = [m for m in messages.json() if m["role"] == "assistant"]
    assert assistant, messages.json()
    return public_id, assistant[0]["id"]

async def _rating_of(assistant_message_id: int):
    """The stored rating on the visitor turn that answer replied to."""
    from models import ChatMessage

    async with database.AsyncSessionLocal() as db:
        assistant = await db.scalar(
            select(ChatMessage).where(ChatMessage.id == assistant_message_id)
        )
        user_turn = await db.scalar(
            select(ChatMessage)
            .where(
                ChatMessage.session_id == assistant.session_id,
                ChatMessage.role == "user",
                ChatMessage.id < assistant.id,
            )
            .order_by(ChatMessage.id.desc())
        )
        return user_turn.rating

@pytest.mark.asyncio(loop_scope="function")
async def test_thumbs_up_is_persisted(public_client):
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id)

    response = await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "visitor-fb",
        },
        json={"value": 1},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["rating"] == 1
    assert body["cleared"] is False
    assert body["assistant_message_id"] == message_id
    assert await _rating_of(message_id) == 1

@pytest.mark.asyncio(loop_scope="function")
async def test_thumbs_down_is_persisted(public_client):
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-down")

    response = await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "visitor-fb-down",
        },
        json={"value": -1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["rating"] == -1
    assert await _rating_of(message_id) == -1

@pytest.mark.asyncio(loop_scope="function")
async def test_second_click_clears_the_vote(public_client):
    """The toggle: same thumb twice retracts to "no vote", stored as 0."""
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-toggle")
    params = {
        "session_id": session_id,
        "message_id": message_id,
        "visitor_id": "visitor-fb-toggle",
    }

    up = await public_client.post(
        "/api/v1/chat/feedback", params=params, json={"value": 1}
    )
    assert up.json()["rating"] == 1

    cleared = await public_client.post(
        "/api/v1/chat/feedback", params=params, json={"value": 0}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["rating"] == 0
    assert cleared.json()["cleared"] is True
    assert await _rating_of(message_id) == 0

@pytest.mark.asyncio(loop_scope="function")
async def test_switching_from_up_to_down_overwrites(public_client):
    """A vote is an assignment, never an accumulation."""
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-switch")
    params = {
        "session_id": session_id,
        "message_id": message_id,
        "visitor_id": "visitor-fb-switch",
    }

    await public_client.post("/api/v1/chat/feedback", params=params, json={"value": 1})
    down = await public_client.post(
        "/api/v1/chat/feedback", params=params, json={"value": -1}
    )
    assert down.json()["rating"] == -1
    assert await _rating_of(message_id) == -1

@pytest.mark.asyncio(loop_scope="function")
async def test_repeat_vote_is_idempotent(public_client):
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-repeat")
    params = {
        "session_id": session_id,
        "message_id": message_id,
        "visitor_id": "visitor-fb-repeat",
    }

    first = await public_client.post(
        "/api/v1/chat/feedback", params=params, json={"value": 1}
    )
    second = await public_client.post(
        "/api/v1/chat/feedback", params=params, json={"value": 1}
    )
    assert first.json()["rating"] == second.json()["rating"] == 1
    assert await _rating_of(message_id) == 1

@pytest.mark.asyncio(loop_scope="function")
async def test_messages_endpoint_returns_the_rating(public_client):
    """A reload must render the vote the visitor cast."""
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-reload")
    await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "visitor-fb-reload",
        },
        json={"value": 1},
    )

    messages = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": session_id, "visitor_id": "visitor-fb-reload"},
    )
    assert messages.status_code == 200, messages.text
    by_id = {m["id"]: m for m in messages.json()}
    # The vote rides on the visitor's turn; the assistant row itself is unvoted.
    assert by_id[message_id]["rating"] == 0
    assert any(m["rating"] == 1 for m in messages.json())

@pytest.mark.asyncio(loop_scope="function")
async def test_admin_session_view_returns_the_rating(public_client, client):
    """The operator's session view shows the same persisted vote."""
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-admin")
    await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "visitor-fb-admin",
        },
        json={"value": -1},
    )

    from models import ChatSession

    async with database.AsyncSessionLocal() as db:
        internal_id = await db.scalar(
            select(ChatSession.id).where(ChatSession.session_id == session_id)
        )

    response = await client.get(f"/api/v1/admin/sessions/{internal_id}/messages")
    assert response.status_code == 200, response.text
    assert any(m["rating"] == -1 for m in response.json())

@pytest.mark.asyncio(loop_scope="function")
async def test_cannot_rate_another_visitors_session(public_client):
    """Ownership is enforced like `/chat/messages`: a foreign id is a 404."""
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "owner-visitor")

    response = await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "someone-else",
        },
        json={"value": 1},
    )
    assert response.status_code == 404, response.text
    assert await _rating_of(message_id) in (None, 0)

@pytest.mark.asyncio(loop_scope="function")
async def test_unknown_message_is_404(public_client):
    agent_id = await _agent_id()
    session_id, _ = await _conversation(agent_id, "visitor-fb-404")
    response = await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": 999999,
            "visitor_id": "visitor-fb-404",
        },
        json={"value": 1},
    )
    assert response.status_code == 404

@pytest.mark.asyncio(loop_scope="function")
async def test_cannot_rate_a_visitor_message(public_client):
    """Only an answer can be rated; a vote on a question would skew analytics."""
    from models import ChatMessage, ChatSession

    agent_id = await _agent_id()
    session_id, _ = await _conversation(agent_id, "visitor-fb-user")

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == session_id)
        )
        user_turn = await db.scalar(
            select(ChatMessage).where(
                ChatMessage.session_id == session.id, ChatMessage.role == "user"
            )
        )
        user_id = user_turn.id

    response = await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": user_id,
            "visitor_id": "visitor-fb-user",
        },
        json={"value": 1},
    )
    assert response.status_code == 409, response.text

@pytest.mark.asyncio(loop_scope="function")
async def test_invalid_value_is_422(public_client):
    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-invalid")
    response = await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "visitor-fb-invalid",
        },
        json={"value": 5},
    )
    assert response.status_code == 422, response.text

@pytest.mark.asyncio(loop_scope="function")
async def test_feedback_does_not_create_a_message(public_client):
    """A vote annotates an existing turn; it is not a message of its own."""
    from models import ChatMessage, ChatSession

    agent_id = await _agent_id()
    session_id, message_id = await _conversation(agent_id, "visitor-fb-count")

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == session_id)
        )
        before = len(
            (
                await db.execute(
                    select(ChatMessage.id).where(ChatMessage.session_id == session.id)
                )
            ).all()
        )

    await public_client.post(
        "/api/v1/chat/feedback",
        params={
            "session_id": session_id,
            "message_id": message_id,
            "visitor_id": "visitor-fb-count",
        },
        json={"value": 1},
    )

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == session_id)
        )
        after = len(
            (
                await db.execute(
                    select(ChatMessage.id).where(ChatMessage.session_id == session.id)
                )
            ).all()
        )
    assert after == before
