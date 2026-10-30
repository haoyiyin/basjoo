"""`GET /api/v1/config:public` online · business_hours · away_message.

Regression guard restored after #64 rewrote `test_escalation_rules_prompt.py`
(the projection tests were collateral damage there). Human handoff and business
hours are untouched features: `online` is still computed on EVERY request from
the agent's schedule, so a first-time visitor never gets a stale state.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

import database
from models import Agent


async def _set_agent(agent_id: str, **fields) -> None:
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        assert agent is not None
        for key, value in fields.items():
            setattr(agent, key, value)
        await db.commit()


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
    """No hours configured → always online."""
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

    The value is computed per request, so the very next call after the config
    change already reflects it — no cache warm-up step.
    """
    now_local = datetime.now(ZoneInfo("Asia/Shanghai"))
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
