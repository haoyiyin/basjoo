"""Issue #62 — the daily message quota is GONE, and its absence is pinned.

The rule the tests now pin, restated because every assertion hangs off it:

    There is no daily message wall. A workspace can serve any number of
    messages in a day; no code path answers `429` for a message-count reason;
    `QUOTA_EXCEEDED` does not exist as an SSE error code; the #44 fallback
    model and its `degraded` marker are gone.

What the issue deliberately KEEPS is the other four workspace limits —
`max_agents`, `max_urls`, `max_qa_items`, `max_total_text_mb` — because they
are storage/abuse guards, not billing. The reverse assertions below prove the
wall is gone AND that the guards still stand.
"""

import pytest
from sqlalchemy import select

import database
from models import Agent, WorkspaceQuota

# A distinct marker so "the model answered" is provable.
MOCK_REPLY_PIECE = None  # set lazily; the MockLLMService speaks for itself.

# ------------------------------------------------------------------ the model

def test_workspace_quota_has_no_message_columns():
    """The three daily-message columns are gone from the model."""
    from models import WorkspaceQuota as Q

    columns = {c.name for c in Q.__table__.columns}
    for retired in (
        "max_messages_per_day",
        "used_messages_today",
        "last_message_reset",
    ):
        assert retired not in columns, f"{retired} must be gone"
    # The storage/abuse guards all stay.
    for kept in (
        "max_agents",
        "max_urls",
        "max_qa_items",
        "max_total_text_mb",
        "used_urls",
        "used_qa_items",
        "used_total_text_mb",
    ):
        assert kept in columns, f"{kept} must survive"

def test_the_quota_service_module_is_deleted():
    """`services/quota.py` existed only to weight the deleted counter."""
    import importlib.util
    import pathlib

    module_path = pathlib.Path(__file__).resolve().parents[1] / "services" / "quota.py"
    assert not module_path.exists(), "services/quota.py must be deleted"

    spec = importlib.util.find_spec("services.quota")
    # A deleted module is not importable; find_spec returning None is the proof.
    assert spec is None, "services.quota must not be importable"


# ------------------------------------------------------------------ the wire

@pytest.mark.asyncio
async def test_the_quota_endpoint_reports_no_daily_counter(client, default_agent_id):
    """`GET /api/v1/quota` keeps the four surviving limits and never carries
    the daily-message fields."""
    response = await client.get(f"/api/v1/quota?agent_id={default_agent_id}")
    assert response.status_code == 200, response.text
    quota = response.json()

    for retired in (
        "max_messages_per_day",
        "used_messages_today",
        "remaining_messages_today",
    ):
        assert retired not in quota, f"{retired} must be gone from the payload"
    for kept in (
        "max_agents",
        "max_urls",
        "max_files",
        "max_total_text_mb",
        "used_agents",
        "used_urls",
        "used_files",
        "used_total_text_mb",
        "remaining_urls",
        "remaining_files",
    ):
        assert kept in quota, f"{kept} must stay on the payload"

@pytest.mark.asyncio
async def test_no_code_path_answers_429_for_a_message_count(
    public_client, default_agent_id, monkeypatch
):
    """Many messages in a row, all answered 200: no 429 exists to hit.

    The mock provider is fast, so this also exercises the old concurrency
    serialization (`check_quota` held a row lock) that no longer runs at all.
    """
    from services.llm_service import MockLLMService

    monkeypatch.setattr(
        "api.v1.endpoints.get_llm_service",
        lambda **kwargs: MockLLMService(model=kwargs.get("model") or "mock-model"),
    )

    for i in range(8):
        response = await public_client.post(
            "/api/v1/chat",
            json={"agent_id": default_agent_id, "message": f"消息 {i}"},
        )
        assert response.status_code == 200, (i, response.text)
        body = response.json()
        assert body["reply"], body
        assert body.get("degraded") in (False, None), "no degraded marker exists"

@pytest.mark.asyncio
async def test_more_than_1500_messages_in_a_day_keeps_answering(
    public_client, default_agent_id, monkeypatch
):
    """The test that would have died at the old 1500 wall: `used_messages_today`
    is set far past the retired cap (by writing the column a legacy DB still
    has — here via a raw row count far beyond the cap on the *live* schema is
    impossible, so the honest proof is the counter's absence).

    The counter does not exist any more, so "more than 1500" is expressed as:
    the DB cannot even hold the number, and the turn still answers.
    """
    from services.llm_service import MockLLMService

    async with database.AsyncSessionLocal() as session:
        columns = {
            c.name for c in WorkspaceQuota.__table__.columns
        }
        assert "used_messages_today" not in columns
        assert "max_messages_per_day" not in columns
        # The workspace row exists and answers nothing about message counts.
        row = await session.scalar(select(WorkspaceQuota).limit(1))
        assert row is not None

    monkeypatch.setattr(
        "api.v1.endpoints.get_llm_service",
        lambda **kwargs: MockLLMService(model=kwargs.get("model") or "mock-model"),
    )
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "第一千五百零一条消息。",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["reply"]

# --------------------------------------------------- the other limits stand

@pytest.mark.asyncio
async def test_the_agent_limit_still_enforces(client, default_agent_id, monkeypatch):
    """`max_agents` is a storage guard, not billing — it still rejects."""
    async with database.AsyncSessionLocal() as session:
        from models import Workspace

        workspace_id = await session.scalar(select(Workspace.id).limit(1))
        quota = await session.scalar(
            select(WorkspaceQuota).where(
                WorkspaceQuota.workspace_id == workspace_id
            )
        )
        assert quota is not None
        quota.max_agents = 1
        await session.commit()

    created = await client.post(
        "/api/v1/agents",
        json={"name": "超出代理上限", "description": "should be rejected"},
    )
    assert created.status_code == 400, created.text
    assert "limit reached" in created.json()["detail"], created.json()

@pytest.mark.asyncio
async def test_the_qa_item_limit_still_enforces(bound_kb_id):
    """`max_qa_items` still reads its quota row: a cap of 0 means "reached"."""
    from services.qa_service import QaService

    from models import KnowledgeBase

    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, bound_kb_id)
        assert kb is not None
        quota = await session.scalar(
            select(WorkspaceQuota).where(
                WorkspaceQuota.workspace_id == kb.workspace_id
            )
        )
        assert quota is not None
        quota.max_qa_items = 0
        await session.commit()

        reached = await QaService().max_items_reached(kb.workspace_id, session)
        assert reached is True, "the qa-item guard must still read its quota row"

        # And a generous cap still means "not reached".
        quota.max_qa_items = 100
        await session.commit()
        reached_again = await QaService().max_items_reached(
            kb.workspace_id, session
        )
        assert reached_again is False
