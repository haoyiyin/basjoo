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
            "name": "WhatsApp Clone",
            "description": "Answers as a personal assistant",
            "agent_type": "ai_clone",
            "channel_mode": "whatsapp",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "WhatsApp Clone"
    assert created["agent_type"] == "ai_clone"
    assert created["channel_mode"] == "whatsapp"
    assert created["workspace_id"] is not None

    list_response = await client.get("/api/v1/agents")
    assert list_response.status_code == 200
    assert list_response.json()["total"] == initial_total + 1

    quota_response = await client.get(f"/api/v1/quota?agent_id={created['id']}")
    assert quota_response.status_code == 200
    assert quota_response.json()["used_agents"] == 1
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
        json={"name": "Agent A", "description": "First agent", "agent_type": "ai_clone"},
    )
    assert create_response_1.status_code == 201
    agent_a_id = create_response_1.json()["id"]

    create_response_2 = await client.post(
        "/api/v1/agents",
        json={"name": "Agent B", "description": "Second agent", "agent_type": "ai_clone"},
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

        session.add(AgentMember(agent_id=agent_a_id, admin_user_id=support_user_id, role="support"))
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
