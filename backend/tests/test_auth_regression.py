"""Regression tests for admin auth protection on management endpoints."""

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("get", "/api/v1/sources:summary", None),
    ],
)
async def test_management_endpoints_require_auth(
    public_client, default_agent_id, method, path, json_body
):
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
        # #40: a <script src> cannot carry a bearer, so the loader is public.
        ("get", "/api/v1/agents/{agent_id}/embed.js", None),
    ],
)
async def test_public_endpoints_remain_accessible(
    public_client, default_agent_id, method, path, json_body
):
    # `embed.js` carries the agent id in the path, not in a query parameter.
    resolved = path.format(agent_id=default_agent_id)
    expects_query_agent_id = "{agent_id}" not in path
    kwargs = {}
    if method == "post":
        kwargs["json"] = {"agent_id": default_agent_id, **(json_body or {})}
    elif expects_query_agent_id:
        kwargs["params"] = {"agent_id": default_agent_id}
    response = await getattr(public_client, method)(resolved, **kwargs)
    assert response.status_code not in (401, 403)
