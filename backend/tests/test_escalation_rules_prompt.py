"""Issue #43 — `escalation_rules` as a prompt layer, and `config:public` online.

Assertion 8: the operator's escalation copy appears in the assembled system
prompt **after** the procedures block (#39), and an empty value adds no block at
all. The assertions read the real prompt `prepare_chat_request` built — not a
helper's return value.

Also covers the C2 half of the issue: `GET /api/v1/config:public` reports
`online`, `business_hours` and `away_message`, computed on every request.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

import database
from models import Agent, ChatSession
from tests.qa_fakes import fake_qa_index, make_http_request

RULES = "如果用户明确要求人工、表达强烈不满或提到退款纠纷，请主动建议转人工。"

TWO_STEPS = [
    {"text": "先确认用户要办理的是退款还是换货。", "requires_action": None},
    {"text": "请用户提供订单号，并说明处理时效。", "requires_action": None},
]


async def _prepare(agent_id: str, session_public_id: str, message: str):
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    request = ChatRequest(
        agent_id=agent_id,
        message=message,
        session_id=session_public_id,
        visitor_id="v1",
        params={},
    )
    async with database.AsyncSessionLocal() as db:
        return await prepare_chat_request(request, make_http_request(), db)


async def _set_agent(agent_id: str, **fields) -> None:
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        assert agent is not None
        for key, value in fields.items():
            setattr(agent, key, value)
        await db.commit()


async def _agent_row(agent_id: str) -> Agent:
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        assert agent is not None
        return agent


# ------------------------------------------------- 8. the prompt layer


@pytest.mark.asyncio
async def test_escalation_rules_appear_after_the_procedures_block(
    client, default_agent_id, fake_qa_index
):
    """Assertion 8a: order is KB → procedures → escalation rules."""
    created = await client.post(
        f"/api/v1/agents/{default_agent_id}/procedures",
        json={"name": "退款流程", "steps": TWO_STEPS},
    )
    assert created.status_code == 201, created.text

    await client.put(
        f"/api/v1/agents/{default_agent_id}/fixed-facts",
        json={"fixed_facts": "固定事实：营业到 22:00。"},
    )
    await _set_agent(default_agent_id, escalation_rules=RULES)

    result = await _prepare(default_agent_id, "sess_escalation_order", "我要退款。")
    system_content = result["messages"][0]["content"]

    assert "升级规则（当以下情形发生时，请主动建议转人工）：" in system_content
    assert RULES in system_content

    procedure_marker = "当前流程「退款流程」"
    assert procedure_marker in system_content, "the procedure block is present"

    assert system_content.index("固定事实：营业到 22:00。") < system_content.index(
        procedure_marker
    ), "fixed facts still come before the procedure"
    assert system_content.index(procedure_marker) < system_content.index(RULES), (
        "the escalation rules are appended AFTER the procedures block"
    )


@pytest.mark.asyncio
async def test_empty_escalation_rules_add_no_block(default_agent_id, fake_qa_index):
    """Assertion 8b: an empty/absent value contributes nothing, not an empty header."""
    from api.v1.endpoints import ESCALATION_RULES_HEADER

    for value in (None, "", "   \n\t "):
        await _set_agent(default_agent_id, escalation_rules=value)
        result = await _prepare(
            default_agent_id, f"sess_no_escalation_{abs(hash(value or 'none'))}", "你好。"
        )
        system_content = result["messages"][0]["content"]
        assert ESCALATION_RULES_HEADER not in system_content, value


@pytest.mark.asyncio
async def test_escalation_rules_are_capped_at_2000_characters(default_agent_id):
    """The issue caps the prompt block at 2000 characters."""
    from api.v1.endpoints import MAX_ESCALATION_RULES_CHARS, build_escalation_rules_block

    assert MAX_ESCALATION_RULES_CHARS == 2000
    block = build_escalation_rules_block("x" * 5000)
    assert len(block.split("\n", 1)[1]) == 2000


# ------------------------------------------------- config:public (C2)


@pytest.mark.asyncio
async def test_config_public_reports_online_business_hours_and_away_message(
    public_client, default_agent_id
):
    """`online` is computed per request from the agent's business hours."""
    await _set_agent(
        default_agent_id,
        business_hours={
            "timezone": "Asia/Shanghai",
            "schedule": [{"day": 0, "start": 540, "end": 1080}],
        },
        away_message="当前非服务时间，请留言。",
    )

    response = await public_client.get(
        f"/api/v1/config:public?agent_id={default_agent_id}"
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["business_hours"] == {
        "timezone": "Asia/Shanghai",
        "schedule": [{"day": 0, "start": 540, "end": 1080}],
    }
    assert payload["away_message"] == "当前非服务时间，请留言。"
    assert isinstance(payload["online"], bool)


@pytest.mark.asyncio
async def test_config_public_is_online_without_business_hours(
    public_client, default_agent_id
):
    """No hours configured → always online (today's behaviour)."""
    await _set_agent(default_agent_id, business_hours=None, away_message=None)

    response = await public_client.get(
        f"/api/v1/config:public?agent_id={default_agent_id}"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["online"] is True
    assert payload["business_hours"] is None
    assert payload["away_message"] is None


@pytest.mark.asyncio
async def test_config_public_flips_offline_when_the_schedule_excludes_now(
    public_client, default_agent_id
):
    """A schedule that is never open reports `online: false` right now.

    The endpoint computes the value per request, so no cache warm-up is needed:
    the very next call after the config changes already reflects it.
    """
    now_local = datetime.now(ZoneInfo("Asia/Shanghai"))
    # A one-minute window that has just passed: never contains "now".
    minutes_now = now_local.hour * 60 + now_local.minute
    closed_start = (minutes_now + 2) % (24 * 60)
    await _set_agent(
        default_agent_id,
        business_hours={
            "timezone": "Asia/Shanghai",
            "schedule": [
                {"day": 0, "start": closed_start, "end": closed_start + 1},
            ],
        },
    )

    response = await public_client.get(
        f"/api/v1/config:public?agent_id={default_agent_id}"
    )
    assert response.status_code == 200, response.text
    assert response.json()["online"] is False


@pytest.mark.asyncio
async def test_public_config_is_online_when_no_agent_exists(public_client):
    """The unconfigured install must not report `offline` and hide the widget."""
    response = await public_client.get("/api/v1/config:public?agent_id=does-not-exist")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["online"] is True
    assert payload["business_hours"] is None
