"""Per-minute rate limit must not be bypassable by dropping `session_id` (LANE A / A3)."""

import pytest
import pytest_asyncio

import database
from core.encryption import encrypt_api_key
from models import Agent

LIMIT = 2
RESTRICTED = "Limited"


@pytest_asyncio.fixture(autouse=True, loop_scope="function")
async def chat_ready_agent(default_agent_id: str) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key("sk-test-rate-limit")
        await session.commit()
    return default_agent_id


async def _enable_limit(client, agent_id: str, limit: int = LIMIT) -> None:
    response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"rate_limit_per_minute": limit, "restricted_reply": RESTRICTED},
    )
    assert response.status_code == 200
    assert response.json()["rate_limit_per_minute"] == limit


async def _chat(public_client, agent_id: str, **extra) -> dict:
    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": agent_id, "message": "spam", **extra},
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_no_session_id_is_limited_per_visitor(
    client, public_client, default_agent_id
) -> None:
    await _enable_limit(client, default_agent_id)

    replies = [
        (await _chat(public_client, default_agent_id, visitor_id="flooder"))["reply"]
        for _ in range(LIMIT + 1)
    ]

    assert replies[:LIMIT] != [RESTRICTED] * LIMIT
    assert replies[-1] == RESTRICTED


@pytest.mark.asyncio
async def test_no_session_id_falls_back_to_visitor_ip(
    client, public_client, default_agent_id
) -> None:
    await _enable_limit(client, default_agent_id, limit=1)

    first = await _chat(public_client, default_agent_id)
    second = await _chat(public_client, default_agent_id)

    assert first["reply"] != RESTRICTED
    assert second["reply"] == RESTRICTED


@pytest.mark.asyncio
async def test_admin_stays_exempt(client, public_client, default_agent_id) -> None:
    await _enable_limit(client, default_agent_id, limit=1)

    for _ in range(2):
        await _chat(public_client, default_agent_id, visitor_id="admin-exempt")

    admin_reply = await _chat(client, default_agent_id, visitor_id="admin-exempt")

    assert admin_reply["reply"] != RESTRICTED
