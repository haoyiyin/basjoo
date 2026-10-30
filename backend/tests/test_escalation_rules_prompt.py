"""Issue #64 — `agent.escalation_rules` is GONE, and its absence is pinned.

The field was a prompt layer appended after the procedures block (#43). It is a
text hint, not a rule engine, so it bought nothing an operator cannot put in
their persona; it cost a concept to learn. It is deleted end to end: column,
migration entry, prompt builder, API payload, settings UI.

The assertions here pin the removal three ways:

1. the helper (`build_escalation_rules_block`, `ESCALATION_RULES_HEADER`,
   `MAX_ESCALATION_RULES_CHARS`) no longer exists on `api.v1.endpoints`, and
   neither does the column on the model;
2. a legacy raw-SQL `escalation_rules` value still sitting in a database that
   predates the drop produces NO escalation header in the assembled prompt —
   the value is inert, not merely hidden — and the prompt ends at the
   procedures block;
3. `PUT /api/v1/agent` carrying the field answers 200 and the field is absent
   from `GET` — ignored, never rejected with a 500.

Human handoff (escalate / takeover / release / resolve / reopen) and business
hours are separate features and are untouched (covered by test_handoff.py and
test_business_hours.py).
"""

import pytest
from sqlalchemy import select, text

import database
from models import Agent, ChatSession, Procedure
from tests.qa_fakes import fake_qa_index, make_http_request

TWO_STEPS = [
    {"text": "先确认用户要办理的是退款还是换货。", "requires_action": None},
    {"text": "请用户提供订单号，并说明处理时效。", "requires_action": None},
]

LEGACY_RULES = "如果用户明确要求人工，请主动建议转人工。"


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


async def _set_agent_raw_sql(agent_id: str, escalation_rules: str) -> None:
    """Write a legacy `escalation_rules` value straight into the table.

    Raw SQL on purpose: the ORM model no longer has the column, so only a
    hand-written statement (the shape an old database file is in) can produce
    the legacy state. On a database created by the current `create_all` the
    column is already gone, so the legacy shape is rebuilt first — the same
    state a pre-#64 file is in after the upgrade's `ALTER TABLE ADD COLUMN`
    predecessors but before the drop step.
    """
    async with database.AsyncSessionLocal() as db:
        await db.execute(
            text(
                "ALTER TABLE agents ADD COLUMN escalation_rules TEXT"
            )
        )
        await db.execute(
            text("UPDATE agents SET escalation_rules = :value WHERE id = :id"),
            {"value": escalation_rules, "id": agent_id},
        )
        await db.commit()


async def _seed_procedure(client, agent_id: str) -> None:
    created = await client.post(
        f"/api/v1/agents/{agent_id}/procedures",
        json={"name": "退款流程", "steps": TWO_STEPS},
    )
    assert created.status_code == 201, created.text


# --------------------------------------------- 1. the helper is gone

def test_the_escalation_prompt_builder_is_gone():
    """`build_escalation_rules_block` and its constants no longer exist."""
    import api.v1.endpoints as endpoints

    assert not hasattr(endpoints, "build_escalation_rules_block")
    assert not hasattr(endpoints, "ESCALATION_RULES_HEADER")
    assert not hasattr(endpoints, "MAX_ESCALATION_RULES_CHARS")

    from models import Agent

    assert not hasattr(Agent, "escalation_rules")


# ------------------------------- 2. the assembled prompt carries no layer

@pytest.mark.asyncio
async def test_a_legacy_escalation_rules_value_produces_no_header(
    client, default_agent_id, fake_qa_index
):
    """A raw-SQL legacy value is inert: no header, no copy, prompt ends at
    the procedures block."""
    await _seed_procedure(client, default_agent_id)
    await _set_agent_raw_sql(default_agent_id, LEGACY_RULES)

    result = await _prepare(default_agent_id, "sess_escalation_absent", "我要退款。")
    system_content = result["messages"][0]["content"]

    assert "升级规则" not in system_content, system_content
    assert "请主动建议转人工" not in system_content, system_content
    assert LEGACY_RULES not in system_content, system_content

    procedure_marker = "当前流程「退款流程」"
    assert procedure_marker in system_content, "the procedure block is present"
    # The prompt ends at the procedures block: its last line is the procedure's
    # last step, and NOTHING follows (#64 removed the layer that used to).
    last_line = system_content.rstrip().splitlines()[-1]
    assert last_line == f"2. {TWO_STEPS[-1]['text']}", (
        f"unexpected content after the procedures block: {last_line!r}"
    )


@pytest.mark.asyncio
async def test_an_empty_value_adds_nothing_either(client, default_agent_id, fake_qa_index):
    """No legacy value at all — the prompt is unchanged from the #39 shape."""
    result = await _prepare(default_agent_id, "sess_no_escalation", "你好。")
    system_content = result["messages"][0]["content"]
    assert "升级规则" not in system_content, system_content


# --------------------------------------- 3. the API field is gone, PUT ignored

@pytest.mark.asyncio
async def test_put_carrying_escalation_rules_is_ignored_and_get_omits_it(client):
    """A PUT that includes `escalation_rules` answers 200 (extra keys are
    dropped by the schema), and the field is absent from the GET payload."""
    agent_id = (await client.get("/api/v1/agent:default")).json()["id"]

    updated = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"escalation_rules": LEGACY_RULES},
    )
    assert updated.status_code == 200, updated.text
    assert "escalation_rules" not in updated.json(), updated.json()

    fetched = await client.get(f"/api/v1/agent?agent_id={agent_id}")
    assert fetched.status_code == 200, fetched.text
    assert "escalation_rules" not in fetched.json(), fetched.json()
