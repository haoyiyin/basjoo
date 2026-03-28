import json

import pytest
from sqlalchemy import select

import database
from config import settings
from models import Agent


@pytest.mark.asyncio
async def test_public_config_exposes_turnstile_for_agent(public_client, default_agent_id, monkeypatch):
    monkeypatch.setattr(settings, "turnstile_site_key", "site-key-123")
    monkeypatch.setattr(settings, "turnstile_secret_key", "secret-key-123")

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(Agent).where(Agent.id == default_agent_id))
        agent = result.scalar_one()
        agent.enable_turnstile = True
        await session.commit()

    response = await public_client.get(f"/api/v1/config:public?agent_id={default_agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["turnstile_enabled"] is True
    assert data["turnstile_site_key"] == "site-key-123"


@pytest.mark.asyncio
async def test_public_chat_requires_turnstile_when_enabled(public_client, default_agent_id, monkeypatch):
    monkeypatch.setattr(settings, "turnstile_site_key", "site-key-123")
    monkeypatch.setattr(settings, "turnstile_secret_key", "secret-key-123")

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(Agent).where(Agent.id == default_agent_id))
        agent = result.scalar_one()
        agent.enable_turnstile = True
        await session.commit()

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "Hello stream",
        },
    )

    assert response.status_code == 200
    body = response.text
    assert '"code": "BOT_PROTECTION_REQUIRED"' in body


@pytest.mark.asyncio
async def test_public_chat_rejects_invalid_turnstile_token(public_client, default_agent_id, monkeypatch):
    monkeypatch.setattr(settings, "turnstile_site_key", "site-key-123")
    monkeypatch.setattr(settings, "turnstile_secret_key", "secret-key-123")

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(Agent).where(Agent.id == default_agent_id))
        agent = result.scalar_one()
        agent.enable_turnstile = True
        await session.commit()

    async def fake_verify(_token, _remote_ip=None, _secret_key=None):
        return False

    from api.v1 import endpoints

    monkeypatch.setattr(endpoints, "verify_turnstile_token", fake_verify)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "Hello stream",
            "turnstile_token": "bad-token",
        },
    )

    assert response.status_code == 200
    body = response.text
    assert '"code": "BOT_PROTECTION_FAILED"' in body


@pytest.mark.asyncio
async def test_admin_chat_bypasses_turnstile_when_enabled(client, default_agent_id, monkeypatch):
    monkeypatch.setattr(settings, "turnstile_site_key", "site-key-123")
    monkeypatch.setattr(settings, "turnstile_secret_key", "secret-key-123")

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(Agent).where(Agent.id == default_agent_id))
        agent = result.scalar_one()
        agent.enable_turnstile = True
        await session.commit()

    response = await client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "Admin playground request",
        },
    )

    assert response.status_code == 200
    body = response.text.strip()
    assert "event: done" in body
    assert 'BOT_PROTECTION' not in body


@pytest.mark.asyncio
async def test_agent_update_persists_turnstile_setting(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    update_response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"enable_turnstile": True},
    )
    assert update_response.status_code == 200
    data = update_response.json()
    assert data["enable_turnstile"] is True
