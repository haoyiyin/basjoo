"""`chat/messages` must be scoped to the visitor that owns the session (LANE A / A2)."""

import pytest
import pytest_asyncio
from sqlalchemy import func, select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession

OWNING_VISITOR = "visitor-owner-1"
OTHER_VISITOR = "visitor-attacker-1"


@pytest_asyncio.fixture(autouse=True, loop_scope="function")
async def chat_ready_agent(default_agent_id: str) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key("sk-test-ownership")
        await session.commit()
    return default_agent_id


async def _message_count(public_session_id: str) -> int:
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(func.count(ChatMessage.id))
            .join(ChatSession, ChatMessage.session_id == ChatSession.id)
            .where(ChatSession.session_id == public_session_id)
        )
        return result.scalar() or 0


async def _start_session(public_client, agent_id: str) -> str:
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "我的银行卡密码是 1234",
            "visitor_id": OWNING_VISITOR,
        },
    )
    assert response.status_code == 200
    return response.json()["session_id"]


@pytest.mark.asyncio
async def test_owning_visitor_reads_transcript(public_client, default_agent_id) -> None:
    session_id = await _start_session(public_client, default_agent_id)

    response = await public_client.get(
        f"/api/v1/chat/messages?session_id={session_id}&visitor_id={OWNING_VISITOR}"
    )

    assert response.status_code == 200
    contents = [message["content"] for message in response.json()]
    assert "我的银行卡密码是 1234" in contents


@pytest.mark.asyncio
async def test_wrong_visitor_gets_404(public_client, default_agent_id) -> None:
    session_id = await _start_session(public_client, default_agent_id)

    response = await public_client.get(
        f"/api/v1/chat/messages?session_id={session_id}&visitor_id={OTHER_VISITOR}"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"


@pytest.mark.asyncio
async def test_missing_visitor_gets_404(public_client, default_agent_id) -> None:
    session_id = await _start_session(public_client, default_agent_id)

    response = await public_client.get(
        f"/api/v1/chat/messages?session_id={session_id}"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"


@pytest.mark.asyncio
async def test_owning_visitor_can_poll_assistant_messages(
    public_client, default_agent_id
) -> None:
    session_id = await _start_session(public_client, default_agent_id)

    response = await public_client.get(
        f"/api/v1/chat/messages?session_id={session_id}"
        f"&visitor_id={OWNING_VISITOR}&after_id=0&role=assistant"
    )

    assert response.status_code == 200
    messages = response.json()
    assert messages
    assert {message["role"] for message in messages} == {"assistant"}


@pytest.mark.asyncio
async def test_mismatched_visitor_cannot_append_to_transcript(
    public_client, default_agent_id
) -> None:
    session_id = await _start_session(public_client, default_agent_id)
    count_before = await _message_count(session_id)

    hijack = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "attacker injected line",
            "session_id": session_id,
            "visitor_id": OTHER_VISITOR,
        },
    )

    assert hijack.status_code == 200
    assert hijack.json()["session_id"] != session_id
    assert await _message_count(session_id) == count_before
