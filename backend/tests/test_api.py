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
async def test_import_csv_skips_header_row(client):
    response = await client.get("/api/v1/agent:default")
    agent_id = response.json()["id"]

    csv_content = "question,answer\nCSV question,CSV answer"
    response = await client.post(
        f"/api/v1/qa:batch_import?agent_id={agent_id}",
        json={"format": "csv", "content": csv_content, "overwrite": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["imported"] == 1
    assert data["failed"] == 0

    list_response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert any(item["question"] == "CSV question" for item in items)
    assert all(item["question"] != "question" for item in items)


def test_get_collection_info_prefers_points_count_when_index_not_reported():
    from types import SimpleNamespace
    from services.qdrant_store import QdrantVectorStore

    store = QdrantVectorStore.__new__(QdrantVectorStore)
    store._get_collection_name = lambda _agent_id: "basjoo_test"
    store.client = SimpleNamespace(
        get_collection=lambda collection_name: SimpleNamespace(
            points_count=3,
            indexed_vectors_count=0,
            status=SimpleNamespace(value="green"),
        )
    )

    info = store.get_collection_info("agt_test")

    assert info["name"] == "basjoo_test"
    assert info["points_count"] == 3
    assert info["vectors_count"] == 3
    assert info["status"] == "green"


@pytest.mark.asyncio
async def test_jina_key_status_jina_with_key(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"embedding_provider": "jina", "jina_api_key": "test_jina_key"},
    )

    response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["embedding_provider"] == "jina"


@pytest.mark.asyncio
async def test_jina_key_status_siliconflow_with_dedicated_key(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"embedding_provider": "siliconflow", "siliconflow_api_key": "sf-test-key"},
    )

    response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["embedding_provider"] == "siliconflow"


@pytest.mark.asyncio
async def test_jina_key_status_siliconflow_legacy_fallback(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "siliconflow",
            "api_key": "sf-legacy-key",
        },
    )

    response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["embedding_provider"] == "siliconflow"


@pytest.mark.asyncio
async def test_jina_key_status_siliconflow_without_key(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "openai",
            "siliconflow_api_key": "",
            "api_key": "",
        },
    )

    response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["embedding_provider"] == "siliconflow"


@pytest.mark.asyncio
async def test_agent_config_reports_effective_siliconflow_embedding_key(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "openai",
            "siliconflow_api_key": "sf-test-key",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["embedding_provider"] == "siliconflow"
    assert data["siliconflow_api_key_set"] is True
    assert data["embedding_api_key_set"] is True


@pytest.mark.asyncio
async def test_agent_config_reports_siliconflow_legacy_embedding_key(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "siliconflow",
            "api_key": "sf-legacy-key",
            "siliconflow_api_key": "",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["embedding_provider"] == "siliconflow"
    assert data["api_key_set"] is True
    assert data["siliconflow_api_key_set"] is False
    assert data["embedding_api_key_set"] is True


@pytest.mark.asyncio
async def test_agent_config_does_not_use_unrelated_api_key_for_siliconflow_embedding(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "openai",
            "api_key": "openai-key",
            "siliconflow_api_key": "",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["api_key_set"] is True
    assert data["siliconflow_api_key_set"] is False
    assert data["embedding_api_key_set"] is False

    status_response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert status_response.status_code == 200
    assert status_response.json()["configured"] is False


@pytest.mark.asyncio
async def test_siliconflow_embedding_key_whitespace_is_not_configured(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "openai",
            "siliconflow_api_key": "   ",
            "api_key": "",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["siliconflow_api_key_set"] is False
    assert data["embedding_api_key_set"] is False

    status_response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert status_response.status_code == 200
    assert status_response.json()["configured"] is False


@pytest.mark.asyncio
async def test_clearing_siliconflow_embedding_key_updates_effective_status(client):
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    configured_response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "embedding_provider": "siliconflow",
            "provider_type": "openai",
            "siliconflow_api_key": "sf-test-key",
            "api_key": "",
        },
    )
    assert configured_response.status_code == 200
    assert configured_response.json()["embedding_api_key_set"] is True

    cleared_response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"siliconflow_api_key": ""},
    )

    assert cleared_response.status_code == 200
    data = cleared_response.json()
    assert data["siliconflow_api_key_set"] is False
    assert data["embedding_api_key_set"] is False

    status_response = await client.get(f"/api/v1/agent:jina-key-status?agent_id={agent_id}")
    assert status_response.status_code == 200
    assert status_response.json()["configured"] is False
