import pytest


@pytest.mark.asyncio
async def test_support_denied_on_agent_endpoints(support_client, default_agent_id):
    endpoints = [
        ("GET", f"/api/v1/agent?agent_id={default_agent_id}"),
        ("PUT", f"/api/v1/agent?agent_id={default_agent_id}"),
        ("GET", f"/api/v1/agent:jina-key-status?agent_id={default_agent_id}"),
        ("GET", f"/api/v1/quota?agent_id={default_agent_id}"),
        ("GET", "/api/v1/agent:default"),
        ("GET", f"/api/v1/tasks:status?agent_id={default_agent_id}"),
        ("GET", f"/api/v1/sources:summary?agent_id={default_agent_id}"),
    ]
    for method, path in endpoints:
        response = await support_client.request(method, path)
        assert response.status_code == 403, f"{method} {path} should be denied for support"


@pytest.mark.asyncio
async def test_support_denied_on_url_endpoints(support_client, default_agent_id):
    response = await support_client.get(
        f"/api/v1/urls:list?agent_id={default_agent_id}"
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_support_denied_on_index_endpoints(support_client, default_agent_id):
    response = await support_client.get(
        f"/api/v1/index:status?agent_id={default_agent_id}"
    )
    assert response.status_code == 403


# ── P1: Knowledge endpoint membership enforcement tests ─────────────────────────


@pytest.mark.asyncio
async def test_admin_assigned_agent_can_access_url_endpoints(client, setup_test_db):
    """Admin assigned to an agent should be able to access URL endpoints."""
    from models import AdminUser, Agent, AgentMember, Workspace, WorkspaceQuota
    from services.auth_service import AuthService
    import database
    from sqlalchemy import select
    from httpx import ASGITransport, AsyncClient
    from main import app

    # Create an admin user with 'admin' role
    async with database.AsyncSessionLocal() as session:
        auth_service = AuthService(session)
        admin_user = await auth_service.create_admin(
            email="test_assigned_admin@example.com",
            password="testpassword123",
            name="Test Assigned Admin",
            role="admin",
        )
        admin_token = auth_service.create_access_token({"sub": str(admin_user.id)})

        # Create a workspace and agent
        workspace = Workspace(name="Test Workspace", owner_email="test@example.com")
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))
        agent = Agent(
            workspace_id=workspace.id,
            name="Assigned Agent",
            description="Agent for assigned admin",
            model="deepseek-chat",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            jina_api_key="test_jina_key",
        )
        session.add(agent)
        await session.flush()

        # Assign admin to this agent
        session.add(AgentMember(agent_id=agent.id, admin_user_id=admin_user.id, role="admin"))
        await session.commit()
        assigned_agent_id = agent.id

    # Create client for assigned admin
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as admin_client:
        admin_client.headers.update({"Authorization": f"Bearer {admin_token}"})

        # Should succeed for assigned agent
        response = await admin_client.get(f"/api/v1/urls:list?agent_id={assigned_agent_id}")
        assert response.status_code == 200

        response = await admin_client.get(f"/api/v1/index:status?agent_id={assigned_agent_id}")
        assert response.status_code == 200

        response = await admin_client.get(f"/api/v1/index:info?agent_id={assigned_agent_id}")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_admin_unassigned_agent_denied_on_url_endpoints(client, setup_test_db):
    """Admin not assigned to an agent should be denied on URL endpoints."""
    from models import AdminUser, Agent
    from services.auth_service import AuthService
    import database
    from sqlalchemy import select
    from httpx import ASGITransport, AsyncClient
    from main import app

    async with database.AsyncSessionLocal() as session:
        auth_service = AuthService(session)
        admin_user = await auth_service.create_admin(
            email="test_unassigned_admin@example.com",
            password="testpassword123",
            name="Test Unassigned Admin",
            role="admin",
        )
        admin_token = auth_service.create_access_token({"sub": str(admin_user.id)})

        result = await session.execute(select(Agent).where(Agent.is_active == True).limit(1))
        agent = result.scalar_one_or_none()
        unassigned_agent_id = agent.id if agent else None
        await session.commit()

    if not unassigned_agent_id:
        pytest.skip("No default agent available")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as admin_client:
        admin_client.headers.update({"Authorization": f"Bearer {admin_token}"})

        response = await admin_client.get(f"/api/v1/urls:list?agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.post(
            f"/api/v1/urls:create?agent_id={unassigned_agent_id}",
            json={"urls": ["https://example.com"]},
        )
        assert response.status_code == 403

        response = await admin_client.post(
            f"/api/v1/urls:refetch?agent_id={unassigned_agent_id}",
            json={"url_ids": [], "force": False},
        )
        assert response.status_code == 403

        response = await admin_client.post(f"/api/v1/urls:cancel?agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.delete(f"/api/v1/urls:delete?url_id=999&agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.post(
            f"/api/v1/urls:discover?agent_id={unassigned_agent_id}&url=https://example.com",
        )
        assert response.status_code == 403

        response = await admin_client.post(
            f"/api/v1/urls:crawl_site?agent_id={unassigned_agent_id}",
            json={"url": "https://example.com", "max_depth": 1, "max_pages": 10},
        )
        assert response.status_code == 403

        response = await admin_client.delete(f"/api/v1/urls:clear_all?agent_id={unassigned_agent_id}")
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_unassigned_agent_denied_on_file_endpoints(client, setup_test_db):
    """Admin not assigned to an agent should be denied on file endpoints."""
    from models import AdminUser, Agent
    from services.auth_service import AuthService
    import database
    from sqlalchemy import select
    from httpx import ASGITransport, AsyncClient
    from main import app

    async with database.AsyncSessionLocal() as session:
        auth_service = AuthService(session)
        admin_user = await auth_service.create_admin(
            email="test_unassigned_files@example.com",
            password="testpassword123",
            name="Test Unassigned Files Admin",
            role="admin",
        )
        admin_token = auth_service.create_access_token({"sub": str(admin_user.id)})

        result = await session.execute(select(Agent).where(Agent.is_active == True).limit(1))
        agent = result.scalar_one_or_none()
        unassigned_agent_id = agent.id if agent else None
        await session.commit()

    if not unassigned_agent_id:
        pytest.skip("No default agent available")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as admin_client:
        admin_client.headers.update({"Authorization": f"Bearer {admin_token}"})

        response = await admin_client.post(
            f"/api/v1/files:upload?agent_id={unassigned_agent_id}",
            files={"files": ("test.txt", b"hello", "text/plain")},
        )
        assert response.status_code == 403

        response = await admin_client.get(f"/api/v1/files:list?agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.delete(f"/api/v1/files:delete?file_id=test&agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.delete(f"/api/v1/files:clear_all?agent_id={unassigned_agent_id}")
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_unassigned_agent_denied_on_index_endpoints(client, setup_test_db):
    """Admin not assigned to an agent should be denied on index endpoints."""
    from models import AdminUser, Agent
    from services.auth_service import AuthService
    import database
    from sqlalchemy import select
    from httpx import ASGITransport, AsyncClient
    from main import app

    async with database.AsyncSessionLocal() as session:
        auth_service = AuthService(session)
        admin_user = await auth_service.create_admin(
            email="test_unassigned_index@example.com",
            password="testpassword123",
            name="Test Unassigned Index Admin",
            role="admin",
        )
        admin_token = auth_service.create_access_token({"sub": str(admin_user.id)})

        result = await session.execute(select(Agent).where(Agent.is_active == True).limit(1))
        agent = result.scalar_one_or_none()
        unassigned_agent_id = agent.id if agent else None
        await session.commit()

    if not unassigned_agent_id:
        pytest.skip("No default agent available")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as admin_client:
        admin_client.headers.update({"Authorization": f"Bearer {admin_token}"})

        response = await admin_client.get(f"/api/v1/index:status?agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.get(f"/api/v1/index:info?agent_id={unassigned_agent_id}")
        assert response.status_code == 403

        response = await admin_client.post(
            f"/api/v1/index:rebuild?agent_id={unassigned_agent_id}",
            json={"force": False},
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_super_admin_can_access_any_agent(client, default_agent_id):
    """Super admin should bypass membership checks and access any agent."""
    # client fixture uses super_admin, which has no AgentMember rows by default
    # but should still be able to access default_agent_id

    response = await client.get(f"/api/v1/urls:list?agent_id={default_agent_id}")
    assert response.status_code == 200

    response = await client.get(f"/api/v1/files:list?agent_id={default_agent_id}")
    assert response.status_code == 200

    response = await client.get(f"/api/v1/index:status?agent_id={default_agent_id}")
    assert response.status_code == 200

    response = await client.get(f"/api/v1/index:info?agent_id={default_agent_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_support_denied_on_file_endpoints(support_client, default_agent_id):
    """Support should remain denied on file endpoints (router-level dependency)."""
    response = await support_client.get(f"/api/v1/files:list?agent_id={default_agent_id}")
    assert response.status_code == 403
