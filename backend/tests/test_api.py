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
    assert "reasoning_effort" in data


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
    if response.status_code == 200:
        data = response.json()
        assert data["email"] == "test@example.com"
        assert data["name"] == "Test Admin"
    else:
        assert response.status_code == 403


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

    if reg_response.status_code == 200:
        email = "login@example.com"
    else:
        email = "test@example.com"

    response = await public_client.post(
        "/api/admin/login",
        json={
            "email": email,
            "password": "testpassword123",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


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
