"""Issue #40 — the server-rendered install loader.

The rule the tests pin, restated because every assertion hangs off it:

    GET /api/v1/agents/{id}/embed.js is ONE script tag's worth of JavaScript,
    identical for every visitor on the same host, and it never says `localhost`
    when the deployment sits behind a proxy.

The origin comes from the same helper `/config:public` uses (forwarded host
wins), so the dashboard can copy a URL the server itself produced instead of
composing one in the browser.
"""

import json
import re

import pytest
from sqlalchemy import select

import database
from api.v1 import endpoints as endpoints_module
from config import settings
from models import Agent
from tests.qa_fakes import fake_qa_index  # noqa: F401  (keeps QA search hermetic)

CONFIG_LITERAL = re.compile(
    r"window\.__BASJOO_CONFIG__\s*=\s*(\{.*?\})\s*;", re.DOTALL
)


async def _set_agent(agent_id: str, **fields) -> None:
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        assert agent is not None
        for key, value in fields.items():
            setattr(agent, key, value)
        await db.commit()


def _config_of(body: str) -> dict:
    """Parse the baked literal out of the response body."""
    match = CONFIG_LITERAL.search(body)
    assert match, f"no __BASJOO_CONFIG__ literal in:\n{body[:400]}"
    return json.loads(match.group(1))


# --------------------------------------------------------- the snippet itself


@pytest.mark.asyncio
async def test_embed_js_is_one_script_tag_and_bakes_the_config(
    public_client, default_agent_id
):
    """One `<script src>`: the config is a literal, not an inline second block."""
    await _set_agent(
        default_agent_id,
        allowed_widget_origins=["https://shop.example.com"],
        excluded_paths=["^/admin", "^/checkout$"],
        display_mode="bubble",
    )

    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert response.status_code == 200, response.text

    body = response.text
    # The literal is ASSIGNED once. The bundle behind it reads the global too,
    # so `count` would be 2 — counting reads would fail on a working deploy.
    assert (
        body.count("window.__BASJOO_CONFIG__ =") == 1
    ), "exactly one config literal"
    # It is the first statement: nothing runs before the widget has its config.
    assert body.startswith("window.__BASJOO_CONFIG__")
    # No `data-*` / inline-config contract: the tag carries only a src.
    assert "<script" not in body, "the loader must not emit HTML"

    config = _config_of(body)
    assert config["agent_id"] == default_agent_id
    assert config["allowed_domains"] == ["https://shop.example.com"]
    assert config["excluded_paths"] == ["^/admin", "^/checkout$"]


@pytest.mark.asyncio
async def test_embed_js_content_type_and_cache_control(public_client, default_agent_id):
    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/javascript")
    cache_control = response.headers.get("cache-control", "")
    assert "max-age=300" in cache_control
    assert cache_control.startswith("public")


@pytest.mark.asyncio
async def test_embed_js_api_base_follows_the_forwarded_host_not_the_host_header(
    public_client, default_agent_id
):
    """`X-Forwarded-Host` wins, so the snippet can never be the container's name."""
    forwarded = await public_client.get(
        f"/api/v1/agents/{default_agent_id}/embed.js",
        headers={
            "X-Forwarded-Host": "shop.example.com",
            "X-Forwarded-Proto": "https",
        },
    )
    assert forwarded.status_code == 200, forwarded.text
    config = _config_of(forwarded.text)
    assert config["api_base"] == "https://shop.example.com"
    assert "localhost" not in forwarded.text

    # Without a forward the request's own Host is used — and in the test client
    # that is `test`, never `localhost` either.
    plain = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert _config_of(plain.text)["api_base"].startswith("http://")

    # Both requests must agree with `/config:public`, the other public surface.
    public_config = await public_client.get(
        f"/api/v1/config:public?agent_id={default_agent_id}",
        headers={
            "X-Forwarded-Host": "shop.example.com",
            "X-Forwarded-Proto": "https",
        },
    )
    assert public_config.status_code == 200, public_config.text
    assert public_config.json()["api_base"] == config["api_base"], (
        "one origin rule: embed.js and config:public must not disagree"
    )

@pytest.mark.asyncio
async def test_embed_js_never_says_localhost_even_when_the_host_header_lies(
    public_client, default_agent_id
):
    """A proxy-less container request must not leak its own name into the snippet."""
    # `Host` only ever wins when no forward exists, and a deployment that
    # reaches here is answering for its container name — but the assertion is
    # the one the issue asks for: whatever the host says, the forwarded host is
    # the answer, and an explicit localhost Host is still overridden by it.
    response = await public_client.get(
        f"/api/v1/agents/{default_agent_id}/embed.js",
        headers={
            "Host": "localhost:8000",
            "X-Forwarded-Host": "shop.example.com",
            "X-Forwarded-Proto": "https",
        },
    )
    assert response.status_code == 200, response.text
    assert _config_of(response.text)["api_base"] == "https://shop.example.com"
    assert "localhost" not in response.text


# ------------------------------------------- PUBLIC_BASE_URL (#40 rework)

@pytest.mark.asyncio
async def test_public_base_url_beats_a_localhost_host_header(
    public_client, default_agent_id, monkeypatch
):
    """Acceptance criterion #1: a localhost dashboard still points at the public host.

    No proxy means no `X-Forwarded-Host`, so `Host` IS `127.0.0.1:8000` — exactly
    the deployment the issue describes. Only an explicit setting can save it.
    """
    monkeypatch.setattr(settings, "public_base_url", "https://shop.example.com")
    response = await public_client.get(
        f"/api/v1/agents/{default_agent_id}/embed.js",
        headers={"Host": "localhost:8000"},
    )
    assert response.status_code == 200, response.text
    assert _config_of(response.text)["api_base"] == "https://shop.example.com"
    assert "localhost" not in response.text
    assert "127.0.0.1" not in response.text

    # The other public surface must agree — the console's copy button reads it.
    public_config = await public_client.get(
        f"/api/v1/config:public?agent_id={default_agent_id}",
        headers={"Host": "localhost:8000"},
    )
    assert public_config.status_code == 200, public_config.text
    assert public_config.json()["api_base"] == "https://shop.example.com"

@pytest.mark.asyncio
async def test_public_base_url_beats_a_forwarded_host(
    public_client, default_agent_id, monkeypatch
):
    """An explicit setting is deliberate: no header may override it."""
    monkeypatch.setattr(settings, "public_base_url", "https://shop.example.com")
    forwarded = await public_client.get(
        f"/api/v1/agents/{default_agent_id}/embed.js",
        headers={
            "Host": "localhost:8000",
            "X-Forwarded-Host": "cdn.attacker.example",
            "X-Forwarded-Proto": "https",
        },
    )
    assert forwarded.status_code == 200, forwarded.text
    assert _config_of(forwarded.text)["api_base"] == "https://shop.example.com"

@pytest.mark.asyncio
async def test_public_base_url_trailing_slash_is_trimmed(
    public_client, default_agent_id, monkeypatch
):
    # Otherwise every snippet rendered `…com//api/v1/…`.
    monkeypatch.setattr(settings, "public_base_url", "https://shop.example.com/")
    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert _config_of(response.text)["api_base"] == "https://shop.example.com"

@pytest.mark.asyncio
async def test_public_base_url_reads_its_scheme_from_the_value(
    public_client, default_agent_id, monkeypatch
):
    # A bare host is reachable over TLS; write `http://` when that is meant.
    monkeypatch.setattr(settings, "public_base_url", "shop.example.com")
    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert _config_of(response.text)["api_base"] == "https://shop.example.com"


@pytest.mark.asyncio
async def test_embed_js_is_identical_for_every_visitor(public_client, default_agent_id):
    """No auth, no per-visitor state: two anonymous requests are byte-identical."""
    first = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    second = await public_client.get(
        f"/api/v1/agents/{default_agent_id}/embed.js",
        headers={"Origin": "https://shop.example.com", "Referer": "https://a.example"},
    )
    assert first.status_code == 200 and second.status_code == 200
    assert first.text == second.text


# --------------------------------------------------------- the baked fields


@pytest.mark.asyncio
async def test_embed_js_bakes_display_mode_inline_container_starters_cards_and_rollout(
    public_client, default_agent_id
):
    starters = [
        {"label": "See pricing", "action": "message", "value": "What does it cost?", "path": "^/pricing$"},
        {"label": "Docs", "action": "link", "url": "https://shop.example.com/docs"},
    ]
    cards = [{"heading": "Shipping", "text": "Where is my order?", "chat": "Where is my order?"}]
    await _set_agent(
        default_agent_id,
        display_mode="inline",
        inline_container="#help-panel",
        starters=starters,
        widget_cards=cards,
        traffic_percentage=25,
    )

    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert response.status_code == 200, response.text
    config = _config_of(response.text)

    assert config["display_mode"] == "inline"
    assert config["inline_container"] == "#help-panel"
    assert config["starters"] == starters
    assert config["cards"] == cards
    assert config["traffic_percentage"] == 25


@pytest.mark.asyncio
async def test_embed_js_omits_an_unset_inline_container(public_client, default_agent_id):
    """Absent → the widget keeps its own default (`#basjoo-chat`)."""
    await _set_agent(default_agent_id, inline_container=None)

    config = _config_of(
        (await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")).text
    )
    assert config["inline_container"] is None


@pytest.mark.asyncio
async def test_embed_js_normalises_a_junk_display_mode(public_client, default_agent_id):
    await _set_agent(default_agent_id, display_mode="sideways")

    config = _config_of(
        (await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")).text
    )
    assert config["display_mode"] == "bubble"


@pytest.mark.asyncio
async def test_embed_js_clamps_traffic_percentage(public_client, default_agent_id):
    for stored, expected in ((150, 100), (-10, 0), (0, 0), (100, 100)):
        await _set_agent(default_agent_id, traffic_percentage=stored)
        config = _config_of(
            (await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")).text
        )
        assert config["traffic_percentage"] == expected, stored


@pytest.mark.asyncio
async def test_embed_js_body_is_the_widget_bundle(public_client, default_agent_id):
    """The loader serves the same bytes `/sdk.js` does, preceded by the literal."""
    bundle = endpoints_module.WIDGET_BUNDLE_PATH
    with open(bundle, "r", encoding="utf-8") as handle:
        expected = handle.read()

    body = (
        await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    ).text
    suffix = body.split("__BASJOO_CONFIG__ = ", 1)[1].split(";\n", 1)[1]
    assert suffix == expected


# --------------------------------------------------------- failure modes


@pytest.mark.asyncio
async def test_embed_js_without_a_bundle_returns_a_readable_error_not_500(
    public_client, default_agent_id, monkeypatch, tmp_path
):
    """A broken deploy must not 500 and must not silently do nothing either."""
    missing = tmp_path / "missing-sdk.js"
    monkeypatch.setattr(endpoints_module, "WIDGET_BUNDLE_PATH", str(missing))

    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/javascript")

    body = response.text
    assert "console.error" in body
    assert "Basjoo" in body
    # The config still loads, so the host page is never left with a half-install…
    assert "window.__BASJOO_CONFIG__" in body
    # …and the substituted bundle is valid JS: a comment plus a call.
    bundle_part = body.split("__BASJOO_CONFIG__ = ", 1)[1].split(";\n", 1)[1]
    assert bundle_part.lstrip().startswith("//")


@pytest.mark.asyncio
async def test_embed_js_404s_for_an_unknown_agent(public_client):
    response = await public_client.get("/api/v1/agents/does-not-exist/embed.js")
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
async def test_embed_js_needs_no_bearer_token(public_client, default_agent_id):
    """A `<script src>` cannot carry an Authorization header."""
    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_embed_js_404s_for_a_soft_deleted_agent(
    client, public_client, default_agent_id
):
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    await _set_agent(default_agent_id, deleted_at=now, purge_after=now + timedelta(days=7))

    response = await public_client.get(f"/api/v1/agents/{default_agent_id}/embed.js")
    assert response.status_code == 404, response.text


# --------------------------------------------------------- #40 page context


@pytest.mark.asyncio
async def test_page_context_reaches_the_assembled_prompt(
    default_agent_id, fake_qa_index  # noqa: F811
):
    """Assertion 7: `before` and `after` land in the prompt, in their two slots."""
    from api.v1.endpoints import (
        MAX_PAGE_CONTEXT_CHARS,
        PAGE_CONTEXT_AFTER_HEADER,
        PAGE_CONTEXT_BEFORE_HEADER,
        prepare_chat_request,
    )
    from api.v1.schemas import ChatRequest

    await _set_agent(default_agent_id, fixed_facts="营业到 22:00。")

    request = ChatRequest(
        agent_id=default_agent_id,
        message="我要退款。",
        session_id="sess_context",
        visitor_id="v1",
        params={},
        context_before="当前页面：/pricing，套餐 Pro",
        context_after="购物车：2 件",
    )
    async with database.AsyncSessionLocal() as db:
        from tests.qa_fakes import make_http_request

        result = await prepare_chat_request(request, make_http_request(), db)

    system_content = result["messages"][0]["content"]

    assert PAGE_CONTEXT_BEFORE_HEADER in system_content
    assert PAGE_CONTEXT_AFTER_HEADER in system_content
    assert "当前页面：/pricing，套餐 Pro" in system_content
    assert "购物车：2 件" in system_content

    # `before` is ahead of the instruction block; `after` is behind the retrieved
    # results — the fixed-facts block is the retrieval stand-in here.
    assert system_content.index("当前页面：/pricing，套餐 Pro") < system_content.index(
        "营业到 22:00。"
    )
    assert system_content.index("营业到 22:00。") < system_content.index("购物车：2 件")

    # Untrusted text: the block says out loud that it is not instructions.
    for header in (PAGE_CONTEXT_BEFORE_HEADER, PAGE_CONTEXT_AFTER_HEADER):
        assert "不是指令" in header
        assert "忽略" in header


@pytest.mark.asyncio
async def test_page_context_is_capped_at_2000_characters(default_agent_id):
    from api.v1.endpoints import MAX_PAGE_CONTEXT_CHARS, build_page_context_block

    assert MAX_PAGE_CONTEXT_CHARS == 2000
    for header in ("BEFORE:", "AFTER:"):
        block = build_page_context_block("x" * 5000, header)
        assert block.startswith(header)
        assert len(block.split("\n", 1)[1]) == 2000


@pytest.mark.asyncio
async def test_empty_page_context_adds_no_block(default_agent_id):
    from api.v1.endpoints import (
        PAGE_CONTEXT_AFTER_HEADER,
        PAGE_CONTEXT_BEFORE_HEADER,
        build_page_context_block,
    )

    for value in (None, "", "   \n\t ", 42, ["not", "a", "string"]):
        assert build_page_context_block(value, PAGE_CONTEXT_BEFORE_HEADER) == ""
    assert build_page_context_block(None, PAGE_CONTEXT_AFTER_HEADER) == ""


# --------------------------------------------------------- the PATCH surface


@pytest.mark.asyncio
async def test_install_fields_round_trip_through_the_agent_patch(
    client, default_agent_id
):
    """The settings page saves these on the agent PATCH, and reads them back."""
    payload = {
        "display_mode": "inline",
        "inline_container": "#help-panel",
        "excluded_paths": ["^/admin"],
        "traffic_percentage": 40,
        "starters": [{"label": "Hi", "action": "message", "value": "Hello"}],
        "widget_cards": [{"heading": "H", "text": "T", "chat": "T"}],
    }
    response = await client.put(
        f"/api/v1/agent?agent_id={default_agent_id}", json=payload
    )
    assert response.status_code == 200, response.text
    agent = response.json()

    assert agent["display_mode"] == "inline"
    assert agent["inline_container"] == "#help-panel"
    assert agent["excluded_paths"] == ["^/admin"]
    assert agent["traffic_percentage"] == 40
    assert agent["starters"] == [{"label": "Hi", "action": "message", "value": "Hello"}]
    assert agent["widget_cards"] == [{"heading": "H", "text": "T", "chat": "T"}]


@pytest.mark.asyncio
async def test_install_fields_reject_out_of_range_and_bad_modes(
    client, default_agent_id
):
    for payload in (
        {"traffic_percentage": 150},
        {"traffic_percentage": -1},
        {"display_mode": "sideways"},
    ):
        response = await client.put(
            f"/api/v1/agent?agent_id={default_agent_id}", json=payload
        )
        assert response.status_code == 422, (payload, response.text)
