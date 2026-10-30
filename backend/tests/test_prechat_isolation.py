"""#41 — prechat values must never reach the model.

This is the assertion the issue is really about: a visitor's name and email are
*identity*, so they may be stored, shown to the operator and emailed — but they
must never appear in the prompt handed to the LLM. A leak here is a privacy bug
that no UI test would catch, so the check is made on the **assembled message
array** that the LLM service receives, with a value distinctive enough that a
substring match is conclusive: `PREHAT_SECRET_EMAIL@example.com`.

The pairing test (a normal turn still appears) is what stops the assertion from
passing for the wrong reason — e.g. if prompt assembly silently stopped
happening.
"""

import pytest
from sqlalchemy import select

import database

SECRET_EMAIL = "PREHAT_SECRET_EMAIL@example.com"
SECRET_NAME = "PREHAT_SECRET_NAME"

@pytest.fixture()
def captured_prompts(monkeypatch):
    """Record every `messages` array handed to the LLM service.

    Monkeypatched at `api.v1.endpoints.get_llm_service` — the seam the chat
    endpoints actually call — so the array captured is exactly the one built by
    `prepare_chat_request`, after every prompt layer has been composed.
    """
    from services.llm_service import MockLLMService

    captured = []

    class CapturingLLM(MockLLMService):
        def __init__(self, *args, **kwargs):
            # The real factory takes `use_mock`, `api_key`, …; the mock only
            # needs the model.
            super().__init__(model=kwargs.get("model") or "mock-model")

        async def chat_completion(self, messages=None, **kwargs):
            captured.append(messages)
            async for chunk in super().chat_completion(messages=messages, **kwargs):
                yield chunk

    def _factory(*args, **kwargs):
        return CapturingLLM(*args, **kwargs)

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", _factory)
    return captured

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

def _flatten(messages) -> str:
    return "\n".join(
        str(message.get("content", "")) for message in (messages or [])
    )

@pytest.mark.asyncio(loop_scope="function")
async def test_prechat_values_never_reach_the_model(public_client, captured_prompts):
    """The core assertion: identity is stored, and the prompt is clean."""
    agent_id = await _agent_id()

    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "What does the pro plan cost?",
            "visitor_id": "visitor-1",
            "prechat": {"name": SECRET_NAME, "email": SECRET_EMAIL},
        },
    )
    assert response.status_code == 200, response.text

    assert captured_prompts, "the chat path must have called the LLM"
    prompt = _flatten(captured_prompts[-1])

    # The normal turn IS there — so a clean prompt cannot be a false pass.
    assert "What does the pro plan cost?" in prompt
    # ...and the prechat values are not, in any role or layer.
    assert SECRET_EMAIL not in prompt
    assert SECRET_NAME not in prompt
    assert "PREHAT_SECRET" not in prompt

@pytest.mark.asyncio(loop_scope="function")
async def test_prechat_values_are_stored_on_the_session(
    public_client, captured_prompts
):
    """They are not dropped either: the operator and the transcript need them."""
    from models import ChatSession, Lead

    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "Hello, can you help?",
            "visitor_id": "visitor-2",
            "prechat": {"name": SECRET_NAME, "email": SECRET_EMAIL},
        },
    )
    assert response.status_code == 200, response.text
    public_id = response.json()["session_id"]

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == public_id)
        )
        assert session.contact_email == SECRET_EMAIL
        assert session.contact_name == SECRET_NAME

        lead = await db.scalar(
            select(Lead).where(Lead.session_id == public_id)
        )
        assert lead is not None
        assert lead.email == SECRET_EMAIL
        assert lead.source == "prechat"

@pytest.mark.asyncio(loop_scope="function")
async def test_prechat_values_never_enter_the_transcript_messages(
    public_client, captured_prompts
):
    """The stored conversation must not contain them either.

    The transcript email and the admin view both read `chat_messages`, so a
    value smuggled into a message row would leak through a second door.
    """
    from models import ChatMessage, ChatSession

    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "Question about pricing",
            "visitor_id": "visitor-3",
            "prechat": {"name": SECRET_NAME, "email": SECRET_EMAIL},
        },
    )
    public_id = response.json()["session_id"]

    async with database.AsyncSessionLocal() as db:
        session = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == public_id)
        )
        rows = (
            await db.execute(
                select(ChatMessage).where(ChatMessage.session_id == session.id)
            )
        ).scalars().all()
    body = "\n".join(row.content for row in rows)
    assert "Question about pricing" in body
    assert SECRET_EMAIL not in body
    assert SECRET_NAME not in body

@pytest.mark.asyncio(loop_scope="function")
async def test_multi_turn_conversation_still_carries_history(
    public_client, captured_prompts
):
    """Identity stays out on turn two as well, where history is included."""
    from models import Agent

    agent_id = await _agent_id()
    # Turn history is only assembled when the agent enables it; the default
    # test agent does not, and this test is specifically about the array that
    # *does* carry earlier turns.
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        agent.enable_context = True
        await db.commit()

    first = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "First question about billing",
            "visitor_id": "visitor-4",
            "prechat": {"name": SECRET_NAME, "email": SECRET_EMAIL},
        },
    )
    assert first.status_code == 200, first.text
    public_id = first.json()["session_id"]

    second = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "Second question about refunds",
            "session_id": public_id,
            "visitor_id": "visitor-4",
            "prechat": {"name": SECRET_NAME, "email": SECRET_EMAIL},
        },
    )
    assert second.status_code == 200, second.text

    prompt = _flatten(captured_prompts[-1])
    assert "Second question about refunds" in prompt
    # History is enabled for the default test agent, so turn one is present.
    assert "First question about billing" in prompt
    assert SECRET_EMAIL not in prompt
    assert SECRET_NAME not in prompt

@pytest.mark.asyncio(loop_scope="function")
async def test_prechat_does_not_change_the_answer(public_client, captured_prompts):
    """The system prompt is byte-identical with and without a prechat block."""
    agent_id = await _agent_id()
    await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "Same question",
            "visitor_id": "no-prechat",
        },
    )
    without = captured_prompts[-1][0]["content"]

    await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "Same question",
            "visitor_id": "with-prechat",
            "prechat": {"name": SECRET_NAME, "email": SECRET_EMAIL},
        },
    )
    with_prechat = captured_prompts[-1][0]["content"]

    assert with_prechat == without

@pytest.mark.asyncio(loop_scope="function")
async def test_blank_prechat_writes_nothing(public_client, captured_prompts):
    """An empty form submission is not a lead."""
    from models import Lead

    agent_id = await _agent_id()
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": "Just browsing",
            "visitor_id": "visitor-blank",
            "prechat": {"name": "  ", "email": "  "},
        },
    )
    assert response.status_code == 200, response.text

    async with database.AsyncSessionLocal() as db:
        leads = (await db.execute(select(Lead))).scalars().all()
    assert leads == []
