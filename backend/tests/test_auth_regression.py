"""Regression tests for admin auth protection on management endpoints."""

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("post", "/api/v1/urls:create", {"urls": ["https://example.com/page"]}),
        ("get", "/api/v1/urls:list", None),
        ("post", "/api/v1/urls:crawl_site", {"url": "https://example.com/"}),
        ("delete", "/api/v1/urls:clear_all", None),
        ("post", "/api/v1/qa:batch_import", {"format": "json", "content": "[]"}),
        ("post", "/api/v1/index:rebuild", {"force": False}),
        ("get", "/api/v1/index:status", None),
        ("get", "/api/v1/index:info", None),
    ],
)
async def test_management_endpoints_require_auth(public_client, default_agent_id, method, path, json_body):
    kwargs = {"json": json_body} if json_body is not None else {}
    response = await getattr(public_client, method)(
        f"{path}?agent_id={default_agent_id}",
        **kwargs,
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("post", "/api/v1/chat", {"message": "hello"}),
        ("get", "/api/v1/config:public", None),
        ("post", "/api/v1/contexts", {"query": "test"}),
        ("get", "/api/v1/sources:summary", None),
    ],
)
async def test_public_endpoints_remain_accessible(public_client, default_agent_id, method, path, json_body):
    kwargs = {}
    if method == "post":
        kwargs["json"] = {"agent_id": default_agent_id, **(json_body or {})}
    response = await getattr(public_client, method)(
        f"{path}?agent_id={default_agent_id}" if method == "get" else path,
        **kwargs,
    )
    assert response.status_code not in (401, 403)
