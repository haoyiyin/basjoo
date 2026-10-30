"""#41 — the offline lead form: capture, idempotency, validation, dashboard.

The contract these tests defend:

* `POST /api/v1/leads` writes one lead per session; a double click, a retry
  after a lost response and a re-submit with corrected details all land on the
  same row, so the operator's lead count is visitors, not requests.
* The field rules are **field-level** 422s (`loc == ["body", "<field>"]`) with
  the limits the issue names: a parseable email, message ≤ 2000, name ≤ 100.
  The widget maps them back onto its own inputs, so the shape matters as much
  as the status.
* The dashboard list is scoped to the workspace and carries the "contacted"
  toggle in both directions.
"""

import pytest
from sqlalchemy import select

import database


async def _agent_id() -> str:
    from models import Agent

    async with database.AsyncSessionLocal() as session:
        agent = (
            await session.execute(
                select(Agent).where(Agent.is_active).order_by(Agent.created_at)
            )
        ).scalars().first()
        assert agent is not None
        return agent.id

async def _session_public_id(agent_id: str) -> str:
    """A real chat session, created the way the widget creates one."""
    from main import app
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": "hello there", "visitor_id": "v-1"},
        )
    assert response.status_code == 200, response.text
    return response.json()["session_id"]

async def _lead_count() -> int:
    from models import Lead

    async with database.AsyncSessionLocal() as session:
        rows = (await session.execute(select(Lead))).scalars().all()
        return len(rows)

async def _field_error_fields(response) -> set:
    """The set of `body.<field>` names the 422 points at."""
    detail = response.json()["detail"]
    return {tuple(item["loc"]) for item in detail}

def _lead_body(agent_id: str, **overrides) -> dict:
    body = {
        "agent_id": agent_id,
        "name": "Dana Visitor",
        "email": "dana@example.com",
        "message": "Please call me back about pricing.",
        "page_url": "https://example.com/pricing",
    }
    body.update(overrides)
    return body

@pytest.mark.asyncio(loop_scope="function")
async def test_submit_lead_stores_every_field(public_client):
    agent_id = await _agent_id()
    session_id = await _session_public_id(agent_id)

    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, session_id=session_id)
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["name"] == "Dana Visitor"
    assert payload["email"] == "dana@example.com"
    assert payload["message"] == "Please call me back about pricing."
    assert payload["page_url"] == "https://example.com/pricing"
    assert payload["session_id"] == session_id
    assert payload["contacted"] is False

    # The identity is mirrored onto the session, which is what the transcript
    # email later uses as its recipient.
    from models import ChatSession

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == session_id)
        )
        assert session is not None
        assert session.contact_email == "dana@example.com"
        assert session.contact_name == "Dana Visitor"

@pytest.mark.asyncio(loop_scope="function")
async def test_double_click_creates_one_lead(public_client):
    """The acceptance contract's idempotency case: two submits, one row."""
    agent_id = await _agent_id()
    session_id = await _session_public_id(agent_id)
    body = _lead_body(agent_id, session_id=session_id)

    first = await public_client.post("/api/v1/leads", json=body)
    second = await public_client.post("/api/v1/leads", json=body)

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    assert first.json()["id"] == second.json()["id"]
    assert await _lead_count() == 1

@pytest.mark.asyncio(loop_scope="function")
async def test_resubmit_updates_instead_of_duplicating(public_client):
    agent_id = await _agent_id()
    session_id = await _session_public_id(agent_id)

    await public_client.post("/api/v1/leads", json=_lead_body(agent_id, session_id=session_id))
    corrected = await public_client.post(
        "/api/v1/leads",
        json=_lead_body(
            agent_id,
            session_id=session_id,
            email="dana.corrected@example.com",
            message="Actually, email me.",
        ),
    )

    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["email"] == "dana.corrected@example.com"
    assert corrected.json()["message"] == "Actually, email me."
    assert await _lead_count() == 1

@pytest.mark.asyncio(loop_scope="function")
async def test_submit_without_session_is_allowed(public_client):
    """A visitor who never got a session id can still leave details."""
    agent_id = await _agent_id()
    response = await public_client.post("/api/v1/leads", json=_lead_body(agent_id))
    assert response.status_code == 201, response.text
    assert response.json()["session_id"] is None

@pytest.mark.asyncio(loop_scope="function")
async def test_bad_email_is_a_field_level_422(public_client):
    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, email="not-an-email")
    )
    assert response.status_code == 422, response.text
    assert ("body", "email") in await _field_error_fields(response)
    # Nothing was written: a rejected submit must not create a half-row.
    assert await _lead_count() == 0

@pytest.mark.asyncio(loop_scope="function")
async def test_email_without_dot_is_rejected(public_client):
    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, email="dana@example")
    )
    assert response.status_code == 422, response.text
    assert ("body", "email") in await _field_error_fields(response)

@pytest.mark.asyncio(loop_scope="function")
async def test_message_over_2000_is_a_field_level_422(public_client):
    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, message="x" * 2001)
    )
    assert response.status_code == 422, response.text
    assert ("body", "message") in await _field_error_fields(response)

@pytest.mark.asyncio(loop_scope="function")
async def test_message_of_exactly_2000_is_accepted(public_client):
    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, message="x" * 2000)
    )
    assert response.status_code == 201, response.text

@pytest.mark.asyncio(loop_scope="function")
async def test_name_over_100_is_a_field_level_422(public_client):
    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, name="n" * 101)
    )
    assert response.status_code == 422, response.text
    assert ("body", "name") in await _field_error_fields(response)

@pytest.mark.asyncio(loop_scope="function")
async def test_blank_name_is_a_field_level_422(public_client):
    """`"   "` passes `min_length` but is not a name the operator can use."""
    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, name="   ")
    )
    assert response.status_code == 422, response.text
    assert ("body", "name") in await _field_error_fields(response)

@pytest.mark.asyncio(loop_scope="function")
async def test_unknown_agent_is_404(public_client):
    response = await public_client.post(
        "/api/v1/leads", json=_lead_body("does-not-exist")
    )
    assert response.status_code == 404

@pytest.mark.asyncio(loop_scope="function")
async def test_paused_agent_refuses_leads(public_client):
    """A paused agent is not accepting conversations, so it takes no leads."""
    from models import Agent

    agent_id = await _agent_id()
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        agent.is_active = False
        await db.commit()
    try:
        response = await public_client.post("/api/v1/leads", json=_lead_body(agent_id))
        assert response.status_code == 403, response.text
    finally:
        async with database.AsyncSessionLocal() as db:
            agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
            agent.is_active = True
            await db.commit()

@pytest.mark.asyncio(loop_scope="function")
async def test_admin_list_returns_the_lead_with_session_link(
    public_client, client
):
    agent_id = await _agent_id()
    session_id = await _session_public_id(agent_id)
    created = await public_client.post(
        "/api/v1/leads", json=_lead_body(agent_id, session_id=session_id)
    )
    assert created.status_code == 201

    response = await client.get("/api/v1/admin/leads")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["uncontacted"] == 1
    item = payload["items"][0]
    assert item["name"] == "Dana Visitor"
    assert item["email"] == "dana@example.com"
    assert item["message"] == "Please call me back about pricing."
    assert item["session_id"] == session_id
    assert item["created_at"]

@pytest.mark.asyncio(loop_scope="function")
async def test_contacted_toggle_round_trips(public_client, client):
    agent_id = await _agent_id()
    created = await public_client.post("/api/v1/leads", json=_lead_body(agent_id))
    lead_id = created.json()["id"]

    marked = await client.patch(
        f"/api/v1/admin/leads/{lead_id}", json={"contacted": True}
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["contacted"] is True
    assert marked.json()["contacted_at"] is not None

    listing = await client.get("/api/v1/admin/leads")
    assert listing.json()["uncontacted"] == 0
    assert listing.json()["items"][0]["contacted"] is True

    # Idempotent in the other direction too: un-marking clears the timestamp.
    cleared = await client.patch(
        f"/api/v1/admin/leads/{lead_id}", json={"contacted": False}
    )
    assert cleared.json()["contacted"] is False
    assert cleared.json()["contacted_at"] is None

@pytest.mark.asyncio(loop_scope="function")
async def test_contacted_filter(public_client, client):
    agent_id = await _agent_id()
    first = await public_client.post("/api/v1/leads", json=_lead_body(agent_id))
    await public_client.post(
        "/api/v1/leads",
        json=_lead_body(agent_id, email="other@example.com", name="Other"),
    )
    await client.patch(
        f"/api/v1/admin/leads/{first.json()['id']}", json={"contacted": True}
    )

    uncontacted = await client.get("/api/v1/admin/leads?contacted=false")
    assert uncontacted.status_code == 200
    assert uncontacted.json()["total"] == 1
    assert uncontacted.json()["items"][0]["email"] == "other@example.com"

@pytest.mark.asyncio(loop_scope="function")
async def test_admin_list_requires_auth(public_client):
    response = await public_client.get("/api/v1/admin/leads")
    assert response.status_code in (401, 403)

@pytest.mark.asyncio(loop_scope="function")
async def test_foreign_workspace_lead_is_404(public_client, client):
    """A lead from another workspace answers exactly like a missing one."""
    from models import Agent, Lead, Workspace, WorkspaceQuota

    async with database.AsyncSessionLocal() as db:
        other = Workspace(name="Other Workspace", owner_email="other@example.com")
        db.add(other)
        await db.flush()
        db.add(WorkspaceQuota(workspace_id=other.id))
        other_agent = Agent(
            workspace_id=other.id,
            name="Other Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            is_active=True,
        )
        db.add(other_agent)
        await db.flush()
        foreign_lead = Lead(
            agent_id=other_agent.id,
            workspace_id=other.id,
            name="Foreign",
            email="foreign@example.com",
            source="offline-form",
        )
        db.add(foreign_lead)
        await db.commit()
        foreign_id = foreign_lead.id

    response = await client.patch(
        f"/api/v1/admin/leads/{foreign_id}", json={"contacted": True}
    )
    assert response.status_code == 404

@pytest.mark.asyncio(loop_scope="function")
async def test_prechat_submission_creates_one_lead(public_client):
    """The prechat form goes through the same upsert, so it is one row too."""
    agent_id = await _agent_id()
    from main import app
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        first = await ac.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "hi, I need help",
                "visitor_id": "v-prechat",
                "prechat": {
                    "name": "Pre Chat",
                    "email": "prechat@example.com",
                },
            },
        )
    assert first.status_code == 200, first.text

    from models import Lead

    async with database.AsyncSessionLocal() as db:
        leads = (await db.execute(select(Lead))).scalars().all()
    assert len(leads) == 1
    assert leads[0].source == "prechat"
    assert leads[0].email == "prechat@example.com"
