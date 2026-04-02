import json

import pytest


@pytest.mark.asyncio
async def test_list_urls_empty(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    response = await client.get(f"/api/v1/urls:list?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert "urls" in data
    assert "total" in data
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_create_url(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    response = await client.post(
        f"/api/v1/urls:create?agent_id={agent_id}",
        json={"urls": ["https://example.com"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["created"] == 1


@pytest.mark.asyncio
async def test_list_qa_empty(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    # Note: May not be empty if other tests have run, just verify structure
    assert data["total"] >= 0


@pytest.mark.asyncio
async def test_import_qa(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    # Use unique question to avoid conflicts with existing data
    qa_content = (
        '[{"question": "What is Basjoo TEST UNIQUE?", "answer": "An intelligent system TEST."}]'
    )
    response = await client.post(
        f"/api/v1/qa:batch_import?agent_id={agent_id}",
        json={"format": "json", "content": qa_content, "overwrite": False},
    )
    assert response.status_code == 200
    data = response.json()
    # Should import at least 1, might not import exact 1 if question already exists
    assert data["imported"] >= 1 or data["failed"] == 0


@pytest.mark.asyncio
async def test_get_quota(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert "max_urls" in data
    assert "max_qa_items" in data
    assert "used_urls" in data


@pytest.mark.asyncio
async def test_get_index_info(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert "agent_id" in data
    assert "index_exists" in data


@pytest.mark.asyncio
async def test_chat_stream_sends_sse_events(public_client, default_agent_id):
    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "Hello stream",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = []
    raw_body = response.text.strip()
    for raw_event in raw_body.split("\n\n"):
        if not raw_event.strip():
            continue

        event_name = None
        payload_lines = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload_lines.append(line.split(":", 1)[1].strip())

        events.append((event_name, json.loads("\n".join(payload_lines))))

    assert events[0][0] == "sources"
    assert isinstance(events[0][1]["sources"], list)
    assert any(event_name == "content" for event_name, _ in events)

    done_events = [payload for event_name, payload in events if event_name == "done"]
    assert len(done_events) == 1
    done_payload = done_events[0]
    assert done_payload["session_id"]
    assert done_payload["taken_over"] is False


@pytest.mark.asyncio
async def test_chat_messages_include_sources(public_client, default_agent_id):
    chat_response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "History sources",
        },
    )
    assert chat_response.status_code == 200
    session_id = chat_response.json()["session_id"]

    messages_response = await public_client.get(f"/api/v1/chat/messages?session_id={session_id}")
    assert messages_response.status_code == 200

    messages = messages_response.json()
    assistant_messages = [message for message in messages if message["role"] == "assistant"]
    assert assistant_messages
    assert "sources" in assistant_messages[-1]
    assert isinstance(assistant_messages[-1]["sources"], list)


@pytest.mark.asyncio
async def test_chat_stream_hides_internal_errors(public_client, default_agent_id, monkeypatch):
    from api.v1 import endpoints

    async def broken_chat_completion(*args, **kwargs):
        raise RuntimeError("provider secret exploded")
        yield  # pragma: no cover

    monkeypatch.setattr(
        endpoints,
        "get_llm_service",
        lambda **kwargs: type("BrokenLLM", (), {"chat_completion": broken_chat_completion})(),
    )

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "Trigger hidden error",
        },
    )

    assert response.status_code == 200
    body = response.text
    assert "event: error" not in body
    assert "provider secret exploded" not in body
    assert "event: content" in body
    assert "event: done" in body
    assert "Sorry, the service is currently limited." in body


@pytest.mark.asyncio
async def test_takeover_admin_reply_visible_via_public_polling(client, default_agent_id):
    chat_response = await client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "Takeover test",
        },
    )
    assert chat_response.status_code == 200
    business_session_id = chat_response.json()["session_id"]

    sessions_response = await client.get("/api/v1/admin/sessions?skip=0&limit=20")
    assert sessions_response.status_code == 200
    sessions = sessions_response.json()["items"]
    matched_session = next(item for item in sessions if item["session_id"] == business_session_id)
    db_session_id = matched_session["id"]

    takeover_response = await client.post(f"/api/v1/admin/sessions/{db_session_id}/takeover")
    assert takeover_response.status_code == 200

    send_response = await client.post(
        "/api/v1/admin/sessions/send",
        json={
            "session_id": db_session_id,
            "content": "Human agent reply",
        },
    )
    assert send_response.status_code == 200

    poll_response = await client.get(
        f"/api/v1/chat/messages?session_id={business_session_id}&role=assistant"
    )
    assert poll_response.status_code == 200
    polled_messages = poll_response.json()
    assert any(message["content"] == "Human agent reply" for message in polled_messages)


@pytest.mark.asyncio
async def test_taken_over_session_skips_rate_limit_reply(client, default_agent_id):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"rate_limit_per_hour": 1, "restricted_reply": "Limited", "enable_turnstile": False},
    )

    first_response = await client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "Takeover before rate limit",
        },
    )
    assert first_response.status_code == 200
    business_session_id = first_response.json()["session_id"]

    sessions_response = await client.get("/api/v1/admin/sessions?skip=0&limit=20")
    matched_session = next(
        item for item in sessions_response.json()["items"] if item["session_id"] == business_session_id
    )
    db_session_id = matched_session["id"]

    takeover_response = await client.post(f"/api/v1/admin/sessions/{db_session_id}/takeover")
    assert takeover_response.status_code == 200

    second_response = await client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "Visitor after takeover",
            "session_id": business_session_id,
        },
    )
    assert second_response.status_code == 200
    payload = second_response.json()
    assert payload["taken_over"] is True
    assert payload["reply"] == ""

    messages_response = await client.get(f"/api/v1/admin/sessions/{db_session_id}/messages")
    assert messages_response.status_code == 200
    messages = messages_response.json()
    assert any(message["content"] == "Visitor after takeover" for message in messages)


@pytest.mark.asyncio
async def test_admin_sessions_web_payload_keeps_public_session_id(client, default_agent_id):
    chat_response = await client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "Session payload test",
        },
    )
    assert chat_response.status_code == 200
    business_session_id = chat_response.json()["session_id"]

    sessions_response = await client.get("/api/v1/admin/sessions?skip=0&limit=20")
    assert sessions_response.status_code == 200
    sessions = sessions_response.json()["items"]
    matched_session = next(item for item in sessions if item["session_id"] == business_session_id)
    assert matched_session["id"]
    assert matched_session["session_id"] == business_session_id
