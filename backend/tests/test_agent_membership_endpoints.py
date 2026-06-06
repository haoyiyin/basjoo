import pytest


@pytest.mark.asyncio
async def test_support_denied_on_agent_endpoints(support_client, default_agent_id):
    endpoints = [
        ("GET", f"/api/v1/agent?agent_id={default_agent_id}", None),
        ("PUT", f"/api/v1/agent?agent_id={default_agent_id}", {"name": "test"}),
        ("GET", f"/api/v1/agent:jina-key-status?agent_id={default_agent_id}", None),
        ("GET", f"/api/v1/quota?agent_id={default_agent_id}", None),
        ("GET", "/api/v1/agent:default", None),
        ("GET", f"/api/v1/tasks:status?agent_id={default_agent_id}", None),
        ("GET", f"/api/v1/sources:summary?agent_id={default_agent_id}", None),
    ]
    for method, path, json_body in endpoints:
        response = await support_client.request(method, path, json=json_body)
        assert response.status_code == 403, (
            f"{method} {path} should be denied for support"
        )


@pytest.mark.asyncio
async def test_role_downgrade_deletes_all_agent_members(client, setup_test_db):
    """When super_admin is downgraded to admin, ALL AgentMember records should be deleted."""
    from models import AdminUser, Agent, AgentMember, Workspace, WorkspaceQuota
    from services.auth_service import AuthService
    import database
    from sqlalchemy import select

    # Create a second workspace with an agent (cross-workspace scenario)
    async with database.AsyncSessionLocal() as session:
        # Get existing super_admin workspace
        super_admin_result = await session.execute(
            select(AdminUser).where(AdminUser.role == "super_admin").limit(1)
        )
        super_admin = super_admin_result.scalar_one_or_none()
        assert super_admin is not None
        super_admin_workspace_id = super_admin.workspace_id

        # Create a second workspace
        workspace2 = Workspace(name="Second Workspace", owner_email="ws2@test.com")
        session.add(workspace2)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace2.id))
        workspace2_id = workspace2.id

        # Create an agent in canonical workspace (same-workspace)
        agent1 = Agent(
            workspace_id=super_admin_workspace_id,
            name="Agent in Canonical Workspace",
            description="Agent for same-workspace test",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent1)
        await session.flush()
        agent1_id = agent1.id

        # Create an agent in second workspace (cross-workspace)
        agent2 = Agent(
            workspace_id=workspace2_id,
            name="Agent in Workspace 2",
            description="Agent for cross-workspace test",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent2)
        await session.flush()
        agent2_id = agent2.id

        # Create a user to downgrade (initially super_admin in canonical workspace)
        auth_service = AuthService(session)
        downgrade_user = await auth_service.create_admin(
            email="downgrade@test.com",
            password="testpassword123",
            name="Downgrade Test",
            role="super_admin",
            workspace_id=super_admin_workspace_id,
        )
        # Add same-workspace membership for downgrade_user
        same_workspace_member = AgentMember(
            agent_id=agent1_id, admin_user_id=downgrade_user.id, role="admin"
        )
        session.add(same_workspace_member)
        # Add cross-workspace membership for downgrade_user (legacy pattern)
        cross_member = AgentMember(
            agent_id=agent2_id, admin_user_id=downgrade_user.id, role="admin"
        )
        session.add(cross_member)

        await session.commit()

        downgrade_user_id = downgrade_user.id

    # Downgrade the user via PATCH /api/admin/users/{id}
    response = await client.patch(
        f"/api/admin/users/{downgrade_user_id}",
        json={"role": "admin"},
    )
    assert response.status_code == 200

    # Verify ALL AgentMember records for this user are deleted
    # (not just cross-workspace, but same-workspace too)
    async with database.AsyncSessionLocal() as session:
        remaining_members = await session.execute(
            select(AgentMember).where(AgentMember.admin_user_id == downgrade_user_id)
        )
        all_members = remaining_members.scalars().all()
        assert len(all_members) == 0, (
            "ALL AgentMember records should be deleted after downgrade from super_admin"
        )

        # Verify the user still exists with new role
        user_result = await session.execute(
            select(AdminUser).where(AdminUser.id == downgrade_user_id)
        )
        user = user_result.scalar_one_or_none()
        assert user.role == "admin"

        # Verify same-workspace agent still exists (not affected)
        agent1_result = await session.execute(
            select(Agent).where(Agent.id == agent1_id)
        )
        assert agent1_result.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_super_admin_create_agent_no_membership(client, setup_test_db):
    """Super admin creating an agent should NOT automatically create AgentMember."""
    from models import AdminUser, Agent, AgentMember
    import database
    from sqlalchemy import select

    # Get existing super_admin
    async with database.AsyncSessionLocal() as session:
        super_admin_result = await session.execute(
            select(AdminUser).where(AdminUser.role == "super_admin").limit(1)
        )
        super_admin = super_admin_result.scalar_one_or_none()
        assert super_admin is not None
        super_admin_id = super_admin.id

    # Create a new agent via API
    response = await client.post(
        "/api/v1/agents",
        json={
            "name": "Test Agent",
            "description": "Agent to test no auto-membership",
            "model": "deepseek-v4-flash",
            "api_base": "https://api.deepseek.com/v1",
            "provider_type": "deepseek",
        },
    )
    assert response.status_code == 201
    new_agent_id = response.json()["id"]

    # Verify no AgentMember was created for super_admin × new_agent
    async with database.AsyncSessionLocal() as session:
        member_result = await session.execute(
            select(AgentMember).where(
                AgentMember.agent_id == new_agent_id,
                AgentMember.admin_user_id == super_admin_id,
            )
        )
        assert member_result.scalar_one_or_none() is None, (
            "Super admin should not have AgentMember record after creating agent"
        )

        # But super_admin should still be able to access the agent via workspace auth
        agent_result = await session.execute(
            select(Agent).where(Agent.id == new_agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        assert agent.workspace_id == super_admin.workspace_id
