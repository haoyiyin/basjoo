import pytest


@pytest.mark.asyncio
async def test_health_check(public_client):
    response = await public_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_root_endpoint(public_client):
    response = await public_client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "version" in data
    assert data["version"] == "1.0.0"


@pytest.mark.asyncio
async def test_large_request_rejection_keeps_cors_headers(public_client):
    response = await public_client.post(
        "/api/admin/login",
        headers={
            "Origin": "https://client.example",
            "Content-Length": str(10 * 1024 * 1024 + 1),
            "Content-Type": "application/json",
        },
        content=b"{}",
    )

    assert response.status_code == 413
    assert response.headers["Access-Control-Allow-Origin"] == "*"
    assert "请求体过大" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_default_agent_requires_auth(public_client):
    response = await public_client.get("/api/v1/agent:default")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_default_agent(client):
    response = await client.get("/api/v1/agent:default")
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "name" in data
    assert "model" in data


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/v1/agent:default", None),
        ("GET", "/api/v1/agent?agent_id={agent_id}", None),
        ("PUT", "/api/v1/agent?agent_id={agent_id}", {"name": "Unauthorized Update"}),
        ("GET", "/api/v1/agent:jina-key-status?agent_id={agent_id}", None),
        ("PUT", "/api/v1/agent:jina-key?agent_id={agent_id}", {"jina_api_key": "test_jina_key"}),
        ("GET", "/api/v1/quota?agent_id={agent_id}", None),
        ("POST", "/api/v1/models:list", {"provider_type": "google", "api_key": "test-key"}),
        ("GET", "/api/v1/tasks:status?agent_id={agent_id}", None),
        ("POST", "/api/v1/agent:test-ai-api?agent_id={agent_id}", None),
        ("POST", "/api/v1/agent:test-jina-api?agent_id={agent_id}", None),
    ],
)
async def test_agent_admin_endpoints_require_auth(public_client, default_agent_id, method, path, payload):
    resolved_path = path.format(agent_id=default_agent_id)

    request = getattr(public_client, method.lower())
    if payload is None:
        response = await request(resolved_path)
    else:
        response = await request(resolved_path, json=payload)

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_register_first_admin(public_client):
    response = await public_client.post(
        "/api/admin/register",
        json={
            "email": "test@example.com",
            "password": "testpassword123",
            "name": "Test Admin",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@example.com"
    assert data["name"] == "Test Admin"
    assert data["role"] == "super_admin"


@pytest.mark.asyncio
async def test_register_second_admin_fails(public_client):
    await public_client.post(
        "/api/admin/register",
        json={
            "email": "first@example.com",
            "password": "testpassword123",
            "name": "First Admin",
        },
    )

    response = await public_client.post(
        "/api/admin/register",
        json={
            "email": "second@example.com",
            "password": "testpassword123",
            "name": "Second Admin",
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_login(public_client):
    reg_response = await public_client.post(
        "/api/admin/register",
        json={
            "email": "login@example.com",
            "password": "testpassword123",
            "name": "Login Test",
        },
    )
    assert reg_response.status_code == 200

    response = await public_client.post(
        "/api/admin/login",
        json={
            "email": "login@example.com",
            "password": "testpassword123",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["admin"]["role"] == "super_admin"


@pytest.mark.asyncio
async def test_login_wrong_password(public_client):
    await public_client.post(
        "/api/admin/register",
        json={
            "email": "test@example.com",
            "password": "testpassword123",
            "name": "Test Admin",
        },
    )

    response = await public_client.post(
        "/api/admin/login",
        json={
            "email": "test@example.com",
            "password": "wrongpassword",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_registration_settings_before_and_after_bootstrap(public_client):
    # Before any admin — bootstrap should be required, public registration disabled.
    res = await public_client.get("/api/admin/registration-settings")
    assert res.status_code == 200
    data = res.json()
    assert data["bootstrap_required"] is True
    assert data["public_registration_enabled"] is False

    # Create the first admin.
    reg = await public_client.post(
        "/api/admin/register",
        json={"email": "bs@example.com", "password": "testpassword123", "name": "BS"},
    )
    assert reg.status_code == 200

    # After bootstrap — still disabled, no longer required.
    res = await public_client.get("/api/admin/registration-settings")
    assert res.status_code == 200
    data = res.json()
    assert data["bootstrap_required"] is False
    assert data["public_registration_enabled"] is False


@pytest.mark.asyncio
async def test_patch_registration_settings_noop(client):
    # The client fixture already creates a super_admin in isolated DBs.
    res = await client.patch(
        "/api/admin/registration-settings",
        json={"public_registration_enabled": True},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["public_registration_enabled"] is False  # always disabled


@pytest.mark.asyncio
async def test_jina_key_status_returns_r2r(client):
    """Embedding status should report the agent's configured provider."""
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["embedding_provider"] == "jina"


@pytest.mark.asyncio
async def test_agent_config_reports_embedding(client):
    """Agent config should report the agent's embedding settings."""
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["embedding_provider"] == "jina"
    assert "embedding_api_key_set" in data


# ── Role permission tests ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_admin_with_readonly_is_rejected(client):
    response = await client.post(
        "/api/admin/users",
        json={
            "email": "readonly_test@example.com",
            "password": "testpassword123",
            "name": "Readonly Test",
            "role": "readonly",
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_update_admin_to_readonly_is_rejected(client):
    # First create a valid user
    create_response = await client.post(
        "/api/admin/users",
        json={
            "email": "support_test2@example.com",
            "password": "testpassword123",
            "name": "Support Test 2",
            "role": "support",
        },
    )
    assert create_response.status_code == 200
    admin_id = create_response.json()["id"]

    # Try to update to readonly
    patch_response = await client.patch(
        f"/api/admin/users/{admin_id}",
        json={"role": "readonly"},
    )
    assert patch_response.status_code == 400


@pytest.mark.asyncio
async def test_support_cannot_manage_users(support_client):
    # List users
    list_response = await support_client.get("/api/admin/users")
    assert list_response.status_code == 403

    # Create user
    create_response = await support_client.post(
        "/api/admin/users",
        json={
            "email": "nosupport@example.com",
            "password": "testpassword123",
            "name": "No Support",
            "role": "support",
        },
    )
    assert create_response.status_code == 403


@pytest.mark.asyncio
async def test_support_can_access_own_me(support_client):
    response = await support_client.get("/api/admin/me")
    assert response.status_code == 200
    assert response.json()["role"] == "support"


@pytest.mark.asyncio
async def test_readonly_denied_on_protected_endpoints(readonly_client, default_agent_id):
    """Legacy readonly role should get 403 on protected routes."""
    response = await readonly_client.get(f"/api/v1/agent?agent_id={default_agent_id}")
    assert response.status_code == 403
