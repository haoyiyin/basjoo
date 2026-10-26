import pytest
from sqlalchemy import select
import database


@pytest.mark.asyncio
async def test_agents_can_be_created_listed_selected_and_deactivated(client):
    list_response = await client.get("/api/v1/agents")
    assert list_response.status_code == 200
    initial_total = list_response.json()["total"]

    create_response = await client.post(
        "/api/v1/agents",
        json={
            "name": "WA Clone",
            "description": "Answers as a personal assistant",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "WA Clone"
    # #20: agent type / channel mode are gone end to end.
    assert "agent_type" not in created
    assert "channel_mode" not in created
    assert created["workspace_id"] is not None

    list_response = await client.get("/api/v1/agents")
    assert list_response.status_code == 200
    assert list_response.json()["total"] == initial_total + 1

    quota_response = await client.get(f"/api/v1/quota?agent_id={created['id']}")
    assert quota_response.status_code == 200
    # used_agents should reflect all agents in workspace, including default agent from test setup
    assert quota_response.json()["used_agents"] >= 1
    assert quota_response.json()["max_agents"] >= 10

    delete_response = await client.delete(f"/api/v1/agents/{created['id']}")
    assert delete_response.status_code == 200
    assert delete_response.json()["success"] is True
    assert delete_response.json()["purge_after"]

    get_response = await client.get(f"/api/v1/agent?agent_id={created['id']}")
    assert get_response.status_code == 410

    restore_response = await client.post(f"/api/v1/agents/{created['id']}:restore")
    assert restore_response.status_code == 200
    assert restore_response.json()["is_active"] is True


# ── P2: Support user agent listing tests ─────────────────────────


@pytest.mark.asyncio
async def test_support_can_list_agents(support_client):
    """Support users should be able to call GET /api/v1/agents."""
    response = await support_client.get("/api/v1/agents")
    assert response.status_code == 200
    data = response.json()
    assert "agents" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_support_with_no_memberships_sees_empty_agent_list(support_client):
    """Support user with no AgentMember rows should see empty list."""
    response = await support_client.get("/api/v1/agents")
    assert response.status_code == 200
    data = response.json()
    # Support user created by fixture has no memberships by default
    assert data["total"] == 0
    assert len(data["agents"]) == 0


@pytest.mark.asyncio
async def test_support_sees_only_assigned_agents(client, support_client, setup_test_db):
    """Support user should only see agents they are assigned to."""
    from models import AgentMember, AdminUser

    # Create two agents as super_admin
    create_response_1 = await client.post(
        "/api/v1/agents",
        json={
            "name": "Agent A",
            "description": "First agent",
        },
    )
    assert create_response_1.status_code == 201
    agent_a_id = create_response_1.json()["id"]

    create_response_2 = await client.post(
        "/api/v1/agents",
        json={
            "name": "Agent B",
            "description": "Second agent",
        },
    )
    assert create_response_2.status_code == 201
    agent_b_id = create_response_2.json()["id"]

    # Get the support user ID and assign to Agent A
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(
            select(AdminUser).where(AdminUser.email == "test_support@example.com")
        )
        support_user = result.scalar_one_or_none()
        assert support_user is not None
        support_user_id = support_user.id

        session.add(
            AgentMember(
                agent_id=agent_a_id, admin_user_id=support_user_id, role="support"
            )
        )
        await session.commit()

    # Support user should see only Agent A
    response = await support_client.get("/api/v1/agents")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["agents"]) == 1
    assert data["agents"][0]["id"] == agent_a_id


@pytest.mark.asyncio
async def test_readonly_denied_on_agent_listing(readonly_client):
    """Readonly role should still be denied on GET /api/v1/agents."""
    response = await readonly_client.get("/api/v1/agents")
    assert response.status_code == 403


# ── Name length validation tests (display width 10) ─────────────────────────


@pytest.mark.asyncio
async def test_agent_name_accepts_ten_ascii_display_units(client):
    response = await client.post(
        "/api/v1/agents",
        json={"name": "AgentName1"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "AgentName1"


@pytest.mark.asyncio
async def test_agent_name_accepts_six_chinese_characters(client):
    response = await client.post(
        "/api/v1/agents",
        json={"name": "客服助手一二"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "客服助手一二"


@pytest.mark.asyncio
async def test_agent_name_accepts_the_builtin_example_name(client):
    # The seeded example agent is "Basjoo 助手" (11 display units); it must remain a
    # legal name so an admin can re-save the example untouched.
    response = await client.post(
        "/api/v1/agents",
        json={"name": "Basjoo 助手"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Basjoo 助手"


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["AgentName1234", "客服助手一二三"])
async def test_agent_name_rejects_more_than_twelve_display_units(client, name):
    response = await client.post(
        "/api/v1/agents",
        json={"name": name},
    )

    assert response.status_code == 422
    assert "12" in response.text


@pytest.mark.asyncio
async def test_agent_update_rejects_over_limit_display_width_name(client):
    create_response = await client.post(
        "/api/v1/agents",
        json={"name": "AgentName1"},
    )
    assert create_response.status_code == 201
    agent_id = create_response.json()["id"]

    update_response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"name": "客服助手一二三"},
    )

    assert update_response.status_code == 422
    assert "12" in update_response.text


# ── #20: agent_type / channel_mode are gone end to end ───────────────────────

@pytest.mark.asyncio
async def test_create_agent_ignores_removed_type_and_channel_fields(client):
    """Extra body keys are ignored by Pydantic and never persisted (#20)."""
    response = await client.post(
        "/api/v1/agents",
        json={
            "name": "NoType",
            "description": "legacy payload",
            "agent_type": "ai_clone",
            "channel_mode": "whatsapp",
        },
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert "agent_type" not in created
    assert "channel_mode" not in created

    listed = await client.get("/api/v1/agents")
    assert listed.status_code == 200
    item = next(a for a in listed.json()["agents"] if a["id"] == created["id"])
    assert "agent_type" not in item
    assert "channel_mode" not in item

    async with database.AsyncSessionLocal() as session:
        from models import Agent

        agent = await session.get(Agent, created["id"])
        assert not hasattr(agent, "agent_type")
        assert not hasattr(agent, "channel_mode")

    await client.delete(f"/api/v1/agents/{created['id']}")


@pytest.mark.asyncio
async def test_agent_payload_keeps_persona_type_and_auto_fetch(client):
    """`persona_type` and `enable_auto_fetch` stay on the wire (only type/channel went)."""
    response = await client.post(
        "/api/v1/agents",
        json={"name": "PersonaK", "persona_type": "sales"},
    )
    assert response.status_code == 201, response.text
    created = response.json()

    assert created["persona_type"] == "sales"
    assert "enable_auto_fetch" in created

    await client.delete(f"/api/v1/agents/{created['id']}")
