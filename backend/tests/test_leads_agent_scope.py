"""#72 follow-up — the lead inbox is agent-scoped for members.

The #72 inbox was workspace-wide, so an `admin`/`support` member of agent A
could read agent B's leads in the same workspace by curl alone. These tests pin
the `list_sessions` contract onto the leads surface:

* `?agent_id=` goes through `require_agent_for_admin` — a stranger answers 403,
  and a super_admin from another workspace answers 403 as well;
* a member with no `agent_id` sees only their own agents' leads, and a member
  with no membership sees an empty inbox, never the whole workspace;
* a lead on somebody else's agent answers the same 404 an unknown id gets, so
  ids stay non-enumerable and the row stays untouched;
* the super_admin roll-up is unchanged.
"""

import pytest
from sqlalchemy import delete, select

import database

SUPPORT_EMAIL = "test_support@example.com"

def _lead_body(agent_id: str, **overrides) -> dict:
    body = {
        "agent_id": agent_id,
        "name": "Dana Visitor",
        "email": "dana@example.com",
        "message": "Please call me back about pricing.",
        "page_url": "https://example.com/pricing",
    }
    body.update(overrides)
    return body

async def _create_agent(client, name: str) -> str:
    response = await client.post(
        "/api/v1/agents", json={"name": name, "description": f"{name} agent"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]

async def _create_lead(public_client, agent_id: str, **overrides) -> dict:
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()

async def _support_user_id() -> int:
    from models import AdminUser

    async with database.AsyncSessionLocal() as session:
        user_id = await session.scalar(
            select(AdminUser.id).where(AdminUser.email == SUPPORT_EMAIL)
        )
    assert user_id is not None, "the support_client fixture seeds this admin"
    return user_id

async def _add_membership(agent_id: str, admin_user_id: int) -> None:
    from models import AgentMember

    async with database.AsyncSessionLocal() as session:
        session.add(
            AgentMember(agent_id=agent_id, admin_user_id=admin_user_id, role="support")
        )
        await session.commit()

async def _drop_memberships(admin_user_id: int) -> None:
    from models import AgentMember

    async with database.AsyncSessionLocal() as session:
        await session.execute(
            delete(AgentMember).where(AgentMember.admin_user_id == admin_user_id)
        )
        await session.commit()

async def _contacted(lead_id: str) -> bool:
    from models import Lead

    async with database.AsyncSessionLocal() as session:
        value = await session.scalar(select(Lead.contacted).where(Lead.id == lead_id))
    assert value is not None
    return bool(value)

@pytest.mark.asyncio
async def test_member_lists_own_agents_leads_only(
    client, public_client, support_client, setup_test_db
):
    agent_a = await _create_agent(client, "Agent A")
    await _create_lead(public_client, agent_a, name="A Visitor")
    support_user_id = await _support_user_id()
    await _add_membership(agent_a, support_user_id)

    response = await support_client.get(f"/api/v1/admin/leads?agent_id={agent_a}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["uncontacted"] == 1
    assert [item["agent_id"] for item in payload["items"]] == [agent_a]
    assert payload["items"][0]["name"] == "A Visitor"

@pytest.mark.asyncio
async def test_member_asking_for_a_foreign_agent_is_403(
    client, public_client, support_client, setup_test_db
):
    agent_a = await _create_agent(client, "Agent A")
    agent_b = await _create_agent(client, "Agent B")
    await _create_lead(public_client, agent_b, name="B Visitor")
    await _add_membership(agent_a, await _support_user_id())

    response = await support_client.get(f"/api/v1/admin/leads?agent_id={agent_b}")
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Agent access denied"

@pytest.mark.asyncio
async def test_member_without_agent_id_sees_only_their_agents(
    client, public_client, support_client, setup_test_db
):
    agent_a = await _create_agent(client, "Agent A")
    agent_b = await _create_agent(client, "Agent B")
    await _create_lead(public_client, agent_a, name="A Visitor")
    await _create_lead(public_client, agent_b, name="B Visitor")
    support_user_id = await _support_user_id()

    # No membership yet: an empty inbox, not the whole workspace.
    empty = await support_client.get("/api/v1/admin/leads")
    assert empty.status_code == 200, empty.text
    assert empty.json()["total"] == 0
    assert empty.json()["uncontacted"] == 0
    assert empty.json()["items"] == []

    await _add_membership(agent_a, support_user_id)

    scoped = await support_client.get("/api/v1/admin/leads")
    assert scoped.status_code == 200, scoped.text
    payload = scoped.json()
    assert payload["total"] == 1
    assert payload["uncontacted"] == 1
    assert [item["agent_id"] for item in payload["items"]] == [agent_a]

@pytest.mark.asyncio
async def test_member_cannot_touch_a_lead_of_a_foreign_agent(
    client, public_client, support_client, setup_test_db
):
    agent_a = await _create_agent(client, "Agent A")
    agent_b = await _create_agent(client, "Agent B")
    foreign_lead = await _create_lead(public_client, agent_b, name="B Visitor")
    await _add_membership(agent_a, await _support_user_id())

    patched = await support_client.patch(
        f"/api/v1/admin/leads/{foreign_lead['id']}", json={"contacted": True}
    )
    assert patched.status_code == 404, patched.text
    assert patched.json()["detail"] == "Lead not found"
    # The refused write changed nothing.
    assert await _contacted(foreign_lead["id"]) is False

    fetched = await support_client.get(f"/api/v1/admin/leads/{foreign_lead['id']}")
    assert fetched.status_code == 404, fetched.text
    assert fetched.json()["detail"] == "Lead not found"

@pytest.mark.asyncio
async def test_member_can_toggle_own_agents_lead(
    client, public_client, support_client, setup_test_db
):
    agent_a = await _create_agent(client, "Agent A")
    lead = await _create_lead(public_client, agent_a, name="A Visitor")
    await _add_membership(agent_a, await _support_user_id())

    patched = await support_client.patch(
        f"/api/v1/admin/leads/{lead['id']}", json={"contacted": True}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["contacted"] is True
    assert await _contacted(lead["id"]) is True

@pytest.mark.asyncio
async def test_super_admin_still_sees_the_workspace_roll_up(
    client, public_client, support_client, setup_test_db
):
    """The #72 behaviour a super_admin already had, unchanged."""
    agent_a = await _create_agent(client, "Agent A")
    agent_b = await _create_agent(client, "Agent B")
    await _create_lead(public_client, agent_a, name="A Visitor")
    await _create_lead(public_client, agent_b, name="B Visitor")

    roll_up = await client.get("/api/v1/admin/leads")
    assert roll_up.status_code == 200, roll_up.text
    assert roll_up.json()["total"] == 2
    assert {item["agent_id"] for item in roll_up.json()["items"]} == {agent_a, agent_b}

    # …and the explicit agent filter still narrows it for them.
    narrowed = await client.get(f"/api/v1/admin/leads?agent_id={agent_a}")
    assert narrowed.status_code == 200, narrowed.text
    assert narrowed.json()["total"] == 1
    assert narrowed.json()["items"][0]["agent_id"] == agent_a

@pytest.mark.asyncio
async def test_memberships_are_per_agent_not_per_workspace(
    client, public_client, support_client, setup_test_db
):
    """Dropping the membership drops the access — it was never workspace-wide."""
    agent_a = await _create_agent(client, "Agent A")
    await _create_lead(public_client, agent_a, name="A Visitor")
    support_user_id = await _support_user_id()
    await _add_membership(agent_a, support_user_id)

    assert (await support_client.get("/api/v1/admin/leads")).json()["total"] == 1

    await _drop_memberships(support_user_id)

    assert (await support_client.get("/api/v1/admin/leads")).json()["total"] == 0
    denied = await support_client.get(f"/api/v1/admin/leads?agent_id={agent_a}")
    assert denied.status_code == 403, denied.text
