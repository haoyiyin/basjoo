"""Issue #44 — a quota that degrades instead of stopping.

The rule the tests pin, restated because every assertion hangs off it:

    used_messages_today >= max_messages_per_day
        → if the agent has a fallback model AND a usable key, answer with the
          fallback and mark the turn degraded;
        → else HTTP 429 / SSE `QUOTA_EXCEEDED`, exactly as before.

Only when both allowances are gone does the request stop, and "the fallback
allowance is gone" means the fallback path cannot serve at all (no model, or no
key on either path) — there is no second counter.

Preview traffic:

    preview=true + a valid admin bearer token → the counter is untouched.
    preview=true without a token            → ignored, the turn is billed.

The public endpoint is unauthenticated, so the flag is honoured only for an
admin — otherwise `preview` would be a free LLM for anyone who reads the API.
"""

import json

import pytest
from sqlalchemy import select, update

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession, Workspace
from services import quota as quota_service
from tests.qa_fakes import fake_qa_index

FALLBACK_MODEL = "cheap-fallback-model"
# A distinct string so "the answer came from the fallback" is provable.
FALLBACK_REPLY = "FALLBACK_PROVIDER_ANSWER 来自备用模型的真实回答。"
PRIMARY_REPLY = "PRIMARY_PROVIDER_ANSWER 来自主模型的回答。"

# ------------------------------------------------------------------ helpers

class _ModelAwareLLM:
    """Provider stub: the reply depends on the model it was built with."""

    def __init__(self) -> None:
        self.model = None

    async def chat_completion(self, **kwargs):
        text = FALLBACK_REPLY if self.model == FALLBACK_MODEL else PRIMARY_REPLY
        for word in text.split():
            yield word + " "

    def get_last_usage(self):
        return None

def _install_llm(monkeypatch, calls: list) -> None:
    """Patch `get_llm_service`, recording every `model=` it was built with."""

    def factory(**kwargs):
        calls.append(kwargs.get("model"))
        llm = _ModelAwareLLM()
        llm.model = kwargs.get("model")
        return llm

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", factory)

def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for raw_event in body.split("\n\n"):
        if not raw_event.strip():
            continue
        name = None
        payload: list[str] = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload.append(line.split(":", 1)[1].strip())
        if name is None:
            continue
        events.append((name, json.loads("\n".join(payload))))
    return events

async def _used_today() -> int:
    async with database.AsyncSessionLocal() as session:
        workspace_id = await session.scalar(select(Workspace.id).limit(1))
        assert workspace_id is not None
        from models import WorkspaceQuota

        quota = await session.scalar(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
        )
        assert quota is not None, "the workspace must have a quota row"
        return int(quota.used_messages_today or 0)

async def _set_used_today(value: int) -> None:
    from datetime import datetime, timezone

    async with database.AsyncSessionLocal() as session:
        from models import WorkspaceQuota

        workspace_id = await session.scalar(select(Workspace.id).limit(1))
        await session.execute(
            update(WorkspaceQuota)
            .where(WorkspaceQuota.workspace_id == workspace_id)
            .values(
                used_messages_today=value,
                last_message_reset=datetime.now(timezone.utc),
            )
        )
        await session.commit()

async def _max_per_day() -> int:
    from models import WorkspaceQuota

    async with database.AsyncSessionLocal() as session:
        workspace_id = await session.scalar(select(Workspace.id).limit(1))
        quota = await session.scalar(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
        )
        assert quota is not None
        return int(quota.max_messages_per_day or 0)

async def _configure_agent(
    agent_id: str,
    *,
    fallback_model: str | None = None,
    fallback_key: str | None = None,
    primary_key: str = "sk-primary-test",
) -> None:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key(primary_key) if primary_key else None
        agent.fallback_model = fallback_model
        agent.fallback_api_key = (
            encrypt_api_key(fallback_key) if fallback_key else None
        )
        await session.commit()

async def _last_assistant_message(session_public_id: str) -> ChatMessage:
    async with database.AsyncSessionLocal() as session:
        message = await session.scalar(
            select(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatSession.session_id == session_public_id,
                ChatMessage.role == "assistant",
            )
            .order_by(ChatMessage.id.desc())
            .limit(1)
        )
        assert message is not None, "the exchange must be persisted"
        return message

# ------------------------------------------------------- the weight hook

def test_every_model_costs_one_message_today():
    """The hook exists so a deployment can set weights without touching chat.

    Today it is a constant 1 — for a primary answer and for a degraded one,
    because the operator already paid for the model they did not get.
    """
    assert quota_service.message_weight("gpt-4.1") == 1
    assert quota_service.message_weight("mini") == 1
    assert quota_service.message_weight(FALLBACK_MODEL) == 1
    assert quota_service.message_weight("") == 1
    assert quota_service.message_weight(None) == 1  # type: ignore[arg-type]
    assert quota_service.DEFAULT_MESSAGE_WEIGHT == 1
    assert quota_service.MODEL_WEIGHTS == {}

def test_the_weight_hook_can_be_retuned_without_touching_the_chat_path(
    monkeypatch,
):
    """A deployment that wants a 10× model only edits the map."""
    monkeypatch.setitem(quota_service.MODEL_WEIGHTS, "gpt-4.1", 10)
    assert quota_service.message_weight("gpt-4.1") == 10
    assert quota_service.message_weight("mini") == 1

# --------------------------------------------------------- the gate itself

def test_no_fallback_model_means_no_degradation():
    from api.v1.endpoints import resolve_llm_degradation

    class Agent_:
        id = "agent-unit-test"
        fallback_model = None
        fallback_api_key = None
        api_key = "sk-x"
        api_base = "https://api.example.com/v1"

    assert resolve_llm_degradation(Agent_()) == {"degraded": False}

def test_a_fallback_model_with_no_key_at_all_does_not_degrade():
    from api.v1.endpoints import (
        get_agent_fallback_plaintext_key,
        resolve_llm_degradation,
    )

    class Agent_:
        id = "agent-unit-test"
        fallback_model = FALLBACK_MODEL
        fallback_api_key = None
        api_key = None
        api_base = "https://api.example.com/v1"

    agent = Agent_()
    assert get_agent_fallback_plaintext_key(agent) is None
    assert resolve_llm_degradation(agent) == {"degraded": False}

def test_a_fallback_model_reuses_the_primary_key_when_it_has_none_of_its_own():
    from core.encryption import encrypt_api_key

    from api.v1.endpoints import resolve_llm_degradation

    class Agent_:
        id = "agent-unit-test"
        fallback_model = FALLBACK_MODEL
        fallback_api_key = None
        api_key = encrypt_api_key("sk-primary")
        api_base = "https://api.example.com/v1"

    decision = resolve_llm_degradation(Agent_())
    assert decision["degraded"] is True
    assert decision["model"] == FALLBACK_MODEL
    assert decision["api_key"] == "sk-primary"

def test_the_fallback_key_is_read_by_its_own_helper():
    from core.encryption import encrypt_api_key

    from api.v1.endpoints import get_agent_fallback_plaintext_key

    class Agent_:
        id = "agent-unit-test"
        fallback_model = FALLBACK_MODEL
        fallback_api_key = encrypt_api_key("sk-fallback")
        api_key = encrypt_api_key("sk-primary")

    assert get_agent_fallback_plaintext_key(Agent_()) == "sk-fallback"

# ----------------------------------- assertion 1: the visitor still gets an answer

@pytest.mark.asyncio
async def test_exhausted_allowance_answers_from_the_fallback_model(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 1: a real answer, from the fallback, with `done.degraded` true."""
    calls: list = []
    _install_llm(monkeypatch, calls)
    await _configure_agent(
        default_agent_id, fallback_model=FALLBACK_MODEL, fallback_key="sk-fallback"
    )
    max_per_day = await _max_per_day()
    await _set_used_today(max_per_day)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "退款窗口是多长时间呢？"},
    )
    assert response.status_code == 200, response.text

    events = _parse_sse(response.text)
    assert [name for name, _ in events].count("error") == 0, events
    done = dict(events)["done"]

    # The whole point of the issue: an answer, not a wall.
    content = "".join(
        payload["content"] for name, payload in events if name == "content"
    )
    assert FALLBACK_REPLY.split()[0] in content, content
    assert PRIMARY_REPLY.split()[0] not in content
    assert done["degraded"] is True
    assert done["model"] == FALLBACK_MODEL
    assert done["message_id"] is not None
    # The LLM service really was built with the fallback model.
    assert calls == [FALLBACK_MODEL], calls

    message = await _last_assistant_message(done["session_id"])
    assert FALLBACK_REPLY.split()[0] in (message.content or "")

@pytest.mark.asyncio
async def test_the_fallback_key_is_used_when_present(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """The fallback path authenticates with its own key, not the primary one."""
    recorded: list = []

    def factory(**kwargs):
        recorded.append(kwargs)
        llm = _ModelAwareLLM()
        llm.model = kwargs.get("model")
        return llm

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", factory)
    await _configure_agent(
        default_agent_id, fallback_model=FALLBACK_MODEL, fallback_key="sk-fallback"
    )
    max_per_day = await _max_per_day()
    await _set_used_today(max_per_day)

    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": "备用品密钥是否生效？"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["degraded"] is True
    assert body["model"] == FALLBACK_MODEL
    assert recorded and recorded[0]["api_key"] == "sk-fallback", recorded

# ------------------------------------- assertion 2: no fallback still stops at 429

@pytest.mark.asyncio
async def test_no_fallback_configured_still_answers_429(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 2: today's behaviour is unchanged without a fallback model."""
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=None)
    max_per_day = await _max_per_day()
    await _set_used_today(max_per_day)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "额度用尽后会发生什么？"},
    )
    assert response.status_code == 200, response.text
    events = _parse_sse(response.text)
    error = dict(events).get("error")
    assert error is not None, events
    assert error["code"] == "QUOTA_EXCEEDED"
    assert [name for name, _ in events].count("done") == 0

    # The blocking route keeps its HTTP status: that is the regression guard.
    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": "额度用尽后会发生什么？"},
    )
    assert blocking.status_code == 429, blocking.text
    assert blocking.json()["detail"] == "Daily message quota exceeded"

@pytest.mark.asyncio
async def test_a_fallback_model_without_any_key_still_answers_429(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """A fallback model the agent cannot authenticate is not a fallback."""
    _install_llm(monkeypatch, [])
    await _configure_agent(
        default_agent_id,
        fallback_model=FALLBACK_MODEL,
        fallback_key=None,
        primary_key=None,
    )
    max_per_day = await _max_per_day()
    await _set_used_today(max_per_day)

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": "没有密钥的备用模型会怎样？"},
    )
    assert blocking.status_code == 429, blocking.text

# ------------------------- assertion 7: a degraded answer costs exactly one message

@pytest.mark.asyncio
async def test_a_degraded_answer_increments_the_counter_by_exactly_one(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 7: a fallback answer costs 1 — the same as a primary one."""
    _install_llm(monkeypatch, [])
    await _configure_agent(
        default_agent_id, fallback_model=FALLBACK_MODEL, fallback_key="sk-fallback"
    )
    max_per_day = await _max_per_day()
    # At the cap, so the degrade path engages; the increment is still exactly 1.
    await _set_used_today(max_per_day)
    before = await _used_today()
    assert before == max_per_day

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "降级回答会消耗多少额度？"},
    )
    assert response.status_code == 200, response.text
    events = _parse_sse(response.text)
    done = dict(events)["done"]
    assert done["degraded"] is True

    after = await _used_today()
    assert after == before + 1, "exactly one message, not zero and not two"
    assert after == max_per_day + 1

@pytest.mark.asyncio
async def test_a_primary_answer_also_costs_exactly_one(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """The counter is a message counter: primary and degraded are both 1."""
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=FALLBACK_MODEL)
    await _set_used_today(0)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "正常回答消耗多少额度？"},
    )
    assert response.status_code == 200, response.text
    done = dict(_parse_sse(response.text))["done"]
    assert done["degraded"] is False
    assert done["model"] is not None
    assert await _used_today() == 1

# ------------------------------------------ assertions 5 and 6: preview traffic

@pytest.mark.asyncio
async def test_preview_traffic_leaves_the_counter_unchanged(
    client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 5: an admin's preview turn is free and still persists."""
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=None)
    await _set_used_today(7)
    assert await _used_today() == 7

    response = await client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "调试区的预览消息是否计费？",
            "preview": True,
        },
    )
    assert response.status_code == 200, response.text
    events = _parse_sse(response.text)
    done = dict(events)["done"]
    assert done["message_id"] is not None, events

    assert await _used_today() == 7, "the counter must be identical before/after"

    message = await _last_assistant_message(done["session_id"])
    assert message.content, "the answer still persisted"

@pytest.mark.asyncio
async def test_preview_still_answers_when_the_allowance_is_already_spent(
    client, default_agent_id, fake_qa_index, monkeypatch
):
    """A preview never hits the wall either: no 429, and no charge."""
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=None)
    max_per_day = await _max_per_day()
    await _set_used_today(max_per_day)

    response = await client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "额度用尽后调试区还能测试吗？",
            "preview": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["reply"], "a preview is still a real turn"
    assert await _used_today() == max_per_day

@pytest.mark.asyncio
async def test_preview_without_an_admin_token_is_ignored(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 6: the public endpoint must not become a free LLM."""
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=None)
    await _set_used_today(3)
    assert await _used_today() == 3

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "匿名请求声称是预览，会被计费吗？",
            "preview": True,
        },
    )
    assert response.status_code == 200, response.text
    done = dict(_parse_sse(response.text))["done"]
    assert done["message_id"] is not None

    assert await _used_today() == 4, "the flag is ignored, the turn is billed"

@pytest.mark.asyncio
async def test_a_garbage_bearer_token_does_not_unlock_preview(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """A token that does not resolve to an admin is the same as no token."""
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=None)
    await _set_used_today(5)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "伪造的 token 能免单吗？",
            "preview": True,
        },
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert response.status_code == 200, response.text
    assert await _used_today() == 6

@pytest.mark.asyncio
async def test_preview_is_off_by_default_for_every_existing_caller(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """The field defaults to False, so nobody opts in by accident."""
    from api.v1.schemas import ChatRequest

    assert ChatRequest(agent_id="a", message="hi").preview is False
    _install_llm(monkeypatch, [])
    await _configure_agent(default_agent_id, fallback_model=None)
    await _set_used_today(0)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "默认请求会被计费吗？"},
    )
    assert response.status_code == 200, response.text
    assert await _used_today() == 1
