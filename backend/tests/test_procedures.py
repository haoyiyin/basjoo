"""Issue #39 — procedures run ONE step per turn; an unavailable action skips all.

State lives on `ChatSession.active_procedure_id` / `procedure_step`, so the step
advances deterministically. The second rule is the counter-intuitive one: a
procedure that needs an action this channel lacks is *never* injected — no partial
execution, no stray step 1.
"""

import pytest
from sqlalchemy import select, update

import database
from models import ChatSession, Procedure
from tests.qa_fakes import fake_qa_index, make_http_request

TWO_STEPS = [
    {"text": "先确认用户要办理的是退款还是换货。", "requires_action": None},
    {"text": "请用户提供订单号，并说明处理时效。", "requires_action": None},
]

async def _call_chat(agent_id: str, session_public_id: str, message: str):
    """Run `prepare_chat_request` for an existing session and return the result."""
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    request = ChatRequest(
        agent_id=agent_id,
        message=message,
        session_id=session_public_id,
        params={},
    )
    async with database.AsyncSessionLocal() as db:
        return await prepare_chat_request(request, make_http_request(), db)

async def _session_state(session_public_id: str) -> ChatSession:
    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == session_public_id)
        )
        assert session is not None
        return session

def _system(result) -> str:
    return result["messages"][0]["content"]

@pytest.mark.asyncio
async def test_two_step_procedure_advances_one_step_per_turn(
    client, default_agent_id, fake_qa_index
):
    """Assertion 6: step 1, then step 2 (pointer = 2), then both fields clear."""
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "退款流程", "steps": TWO_STEPS},
    )
    assert created.status_code == 201, created.text
    procedure_id = created.json()["id"]

    session_public_id = "sess_procedure_two_steps"

    first = await _call_chat(default_agent_id, session_public_id, "我要退款。")
    first_content = _system(first)
    assert "当前流程「退款流程」共 2 步，本轮只执行第 1 步并等待用户回应：" in first_content
    assert "1. 先确认用户要办理的是退款还是换货。" in first_content
    assert "2. 请用户提供订单号，并说明处理时效。" in first_content

    state = await _session_state(session_public_id)
    assert state.active_procedure_id == procedure_id
    assert state.procedure_step == 1

    # Second turn: the next step, and the pointer is 2 (the count of steps run).
    second = await _call_chat(default_agent_id, session_public_id, "退款。")
    second_content = _system(second)
    assert "本轮只执行第 2 步并等待用户回应：" in second_content
    assert "1. 先确认用户要办理的是退款还是换货。" in second_content

    state = await _session_state(session_public_id)
    assert state.procedure_step == 2, "two calls mean two executed steps"

    # Third turn: the script is exhausted — detached, nothing injected.
    third = await _call_chat(default_agent_id, session_public_id, "订单号 12345。")
    assert "当前流程「退款流程」" not in _system(third)
    state = await _session_state(session_public_id)
    assert state.active_procedure_id is None
    assert state.procedure_step == 0

@pytest.mark.asyncio
async def test_procedure_with_unavailable_action_is_never_injected(
    client, default_agent_id, fake_qa_index, caplog
):
    """Assertion 7: step 1 needs `phone` — the whole procedure is skipped."""
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={
            "name": "电话回访流程",
            "steps": [
                {"text": "先核对用户的手机号后四位。", "requires_action": "phone"},
                {"text": "再约定回访时间。", "requires_action": None},
            ],
        },
    )
    assert created.status_code == 201, created.text

    session_public_id = "sess_procedure_unavailable"
    with caplog.at_level("INFO", logger="services.procedure_service"):
        result = await _call_chat(default_agent_id, session_public_id, "帮我处理一下。")

    content = _system(result)
    assert "电话回访流程" not in content, "an unavailable action skips the whole procedure"
    assert "先核对用户的手机号后四位。" not in content
    assert "再约定回访时间。" not in content

    state = await _session_state(session_public_id)
    assert state.active_procedure_id is None
    assert (state.procedure_step or 0) == 0, "no half-run: the pointer never moved"

    assert any(
        "unavailable action" in message for message in caplog.messages
    ), "the skip must be logged with its reason"

@pytest.mark.asyncio
async def test_unavailable_action_in_a_later_step_also_skips_everything(
    client, default_agent_id, fake_qa_index
):
    """The rule is per-procedure, not per-step: step 2 needing a phone still blocks."""
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={
            "name": "混合流程",
            "steps": [
                {"text": "第一步：确认问题。", "requires_action": None},
                {"text": "第二步：电话联系用户。", "requires_action": "phone"},
            ],
        },
    )
    assert created.status_code == 201, created.text

    result = await _call_chat(default_agent_id, "sess_procedure_mixed", "你好。")
    assert "混合流程" not in _system(result)
    assert "第一步：确认问题。" not in _system(result)

@pytest.mark.asyncio
async def test_link_and_form_actions_are_available(client, default_agent_id, fake_qa_index):
    """`link` is always available; `form` is available when configured (#41 owns it)."""
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={
            "name": "链接流程",
            "steps": [
                {
                    "text": "把这预约链接发给用户：https://booking.example.com",
                    "requires_action": "link",
                }
            ],
        },
    )
    assert created.status_code == 201, created.text

    result = await _call_chat(default_agent_id, "sess_procedure_link", "怎么预约？")
    assert "链接流程" in _system(result)

@pytest.mark.asyncio
async def test_disabled_procedure_is_not_injected(
    client, default_agent_id, fake_qa_index
):
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "停用流程", "steps": TWO_STEPS, "enabled": False},
    )
    assert created.status_code == 201, created.text

    result = await _call_chat(default_agent_id, "sess_procedure_disabled", "你好。")
    assert "停用流程" not in _system(result)

@pytest.mark.asyncio
async def test_only_the_first_enabled_procedure_is_used(
    client, default_agent_id, fake_qa_index
):
    """Selection is the oldest enabled procedure, deterministically."""
    first = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "第一个流程", "steps": [{"text": "第一步。", "requires_action": None}]},
    )
    assert first.status_code == 201, first.text
    second = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "第二个流程", "steps": [{"text": "别的内容。", "requires_action": None}]},
    )
    assert second.status_code == 201, second.text

    listing = await client.get(f"/api/v1/agents/{default_agent_id}/procedures")
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert [item["name"] for item in body["items"]] == ["第一个流程", "第二个流程"]

    result = await _call_chat(default_agent_id, "sess_procedure_first", "你好。")
    content = _system(result)
    assert "第一个流程" in content
    assert "第二个流程" not in content

@pytest.mark.asyncio
async def test_procedure_crud_round_trip(client, default_agent_id, fake_qa_index):
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "售后流程", "steps": TWO_STEPS},
    )
    assert created.status_code == 201, created.text
    procedure_id = created.json()["id"]
    assert created.json()["steps"] == TWO_STEPS

    updated = await client.put(
        f"/api/v1/agents/{default_agent_id}/procedures/{procedure_id}",
        json={
            "name": "售后流程 v2",
            "steps": [{"text": "只保留一步。", "requires_action": "link"}],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "售后流程 v2"
    assert updated.json()["steps"] == [
        {"text": "只保留一步。", "requires_action": "link"}
    ]

    deleted = await client.delete(
        f"/api/v1/agents/{default_agent_id}/procedures/{procedure_id}"
    )
    assert deleted.status_code == 200, deleted.text

    listing = await client.get(f"/api/v1/agents/{default_agent_id}/procedures")
    assert listing.json() == {"items": [], "total": 0}

@pytest.mark.asyncio
async def test_procedure_routes_404_for_unknown_ids_and_cross_agent_access(
    client, default_agent_id, fake_qa_index
):
    missing = await client.put(
        f"/api/v1/agents/{default_agent_id}/procedures/does-not-exist",
        json={"name": "x"},
    )
    assert missing.status_code == 404

    other = await client.post(
        "/api/v1/agents",
        json={"name": "Rival"},
    )
    assert other.status_code == 201, other.text
    other_id = other.json()["id"]

    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "我的流程", "steps": TWO_STEPS},
    )
    procedure_id = created.json()["id"]

    # The other agent cannot see or mutate this agent's procedure.
    foreign = await client.put(
        f"/api/v1/agents/{other_id}/procedures/{procedure_id}",
        json={"name": "劫持"},
    )
    assert foreign.status_code == 404, foreign.text

    listing = await client.get(f"/api/v1/agents/{other_id}/procedures")
    assert listing.json()["total"] == 0

@pytest.mark.asyncio
async def test_stale_active_procedure_is_cleared_when_disabled(
    client, default_agent_id, fake_qa_index
):
    """Disabling mid-conversation detaches the session instead of pinning it."""
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "会话中停用", "steps": TWO_STEPS},
    )
    procedure_id = created.json()["id"]

    session_public_id = "sess_procedure_detach"
    await _call_chat(default_agent_id, session_public_id, "第一步。")
    state = await _session_state(session_public_id)
    assert state.active_procedure_id == procedure_id

    disabled = await client.put(
        f"/api/v1/agents/{default_agent_id}/procedures/{procedure_id}",
        json={"enabled": False},
    )
    assert disabled.status_code == 200

    result = await _call_chat(default_agent_id, session_public_id, "继续。")
    assert "会话中停用" not in _system(result)
    state = await _session_state(session_public_id)
    assert state.active_procedure_id is None

@pytest.mark.asyncio
async def test_procedure_block_is_numbered_and_last_in_the_prompt(
    client, default_agent_id, fake_qa_index
):
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "顺序验证流程", "steps": TWO_STEPS},
    )
    assert created.status_code == 201, created.text

    await client.put(
        f"/api/v1/agents/{default_agent_id}/fixed-facts",
        json={"fixed_facts": "固定事实：营业到 22:00。"},
    )

    session_public_id = "sess_procedure_order"
    result = await _call_chat(default_agent_id, session_public_id, "你好。")
    content = _system(result)

    assert content.index("固定事实：营业到 22:00。") < content.index(
        "当前流程「顺序验证流程」"
    ), "the procedure is appended after every other layer"
    assert content.count("1. ") >= 1
    assert "2. " in content
