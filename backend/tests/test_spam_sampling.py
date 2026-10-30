"""Issue #44 — the spam check is sampled, not run on every message.

Truth first: **there was no spam check in this codebase.** `grep -rn 'spam'
backend/` before this work matched only the `#44` comment on
`ChatSession.ai_turn_count` and one unrelated test message body. So
`backend/services/spam_check.py` is the check (a stdlib heuristic, no new
dependency) plus the sampling rule that decides when it runs.

The rule the tests pin:

    screen a message only when the answered-turn index is 2, 4, 8, 16 (…,
    capped), where the index is `ChatSession.ai_turn_count + 1`.

    a hit → `session.status = "paused"`, so contract C3's `should_ai_answer`
    already refuses to answer: the visitor message is stored, nothing answers.

    the counter advances once per *answered* turn — not per request, and not on
    a paused session. Pausing is per session: a new session for the same
    visitor starts `active`.
"""

import pytest
from sqlalchemy import select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession
from services import spam_check

BENIGN = "请问你们的退款窗口是多长时间呢？"
SPAM = (
    "兼职日结 加微信 稳赚不赔 https://a.example.com https://b.example.com "
    "https://c.example.com https://d.example.com"
)

# ------------------------------------------------------------------ helpers

class _ScriptedLLM:
    def __init__(self, text: str) -> None:
        self._text = text

    async def chat_completion(self, **kwargs):
        for word in self._text.split():
            yield word + " "

    def get_last_usage(self):
        return None

def _install_llm(monkeypatch) -> None:
    monkeypatch.setattr(
        "api.v1.endpoints.get_llm_service",
        lambda **kwargs: _ScriptedLLM("这是助手的正常回答。"),
    )

async def _configure_agent(agent_id: str) -> None:
    """A key is enough (`get_llm_service` is mocked); no KB keeps turns fast."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key("sk-spam-sampling")
        agent.kb_id = None
        await session.commit()

async def _session_by_public_id(public_id: str) -> ChatSession:
    async with database.AsyncSessionLocal() as db:
        row = await db.scalar(
            select(ChatSession)
            .where(ChatSession.session_id == public_id)
            .order_by(ChatSession.created_at.desc(), ChatSession.id.desc())
        )
        assert row is not None, f"session {public_id} should exist"
        return row

async def _messages(public_id: str) -> list[ChatMessage]:
    async with database.AsyncSessionLocal() as db:
        session_row = await _session_by_public_id(public_id)
        rows = (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_row.id)
                .order_by(ChatMessage.id.asc())
            )
        ).scalars().all()
        return list(rows)

async def _turn(
    public_client, agent_id: str, session_id: str, message: str, visitor_id: str = "v1"
) -> dict:
    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": message,
            "session_id": session_id,
            "visitor_id": visitor_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()

# --------------------------------------------------- assertion 3: the ladder

def test_sampling_indices_are_exactly_two_four_eight_sixteen():
    """Assertion 3: the ladder the issue names, as an exact list."""
    assert spam_check.spam_check_indices(16) == [2, 4, 8, 16]
    assert spam_check.spam_check_indices() == [2, 4, 8, 16, 32, 64]

def test_only_the_ladder_turns_are_screened():
    sampled = [turn for turn in range(1, 17) if spam_check.is_sampled_turn(turn)]
    assert sampled == [2, 4, 8, 16], "at most 4 checks in a 16-message session"

def test_the_first_turn_is_never_screened():
    """A visitor's opening line is always answered."""
    assert spam_check.is_sampled_turn(1) is False
    assert spam_check.is_sampled_turn(0) is False
    assert spam_check.is_sampled_turn(-1) is False

def test_the_ladder_is_capped():
    """A long conversation is not screened forever."""
    assert spam_check.is_sampled_turn(64) is True
    assert spam_check.is_sampled_turn(65) is False
    assert spam_check.is_sampled_turn(128) is False
    assert spam_check.is_sampled_turn(1000) is False

@pytest.mark.asyncio
async def test_sixteen_answered_turns_trigger_exactly_four_checks(
    public_client, default_agent_id, monkeypatch
):
    """Assertion 3, on the real chat path: the screener is called 4×, not 16×."""
    calls: list[tuple[int, str]] = []
    real_classify = spam_check.classify_message

    def spy(text: str):
        calls.append((len(calls) + 1, text))
        return real_classify(text)

    monkeypatch.setattr(spam_check, "classify_message", spy)
    _install_llm(monkeypatch)
    await _configure_agent(default_agent_id)

    public_id = "sess_spam_16"
    for index in range(16):
        await _turn(public_client, default_agent_id, public_id, BENIGN)

    # Four checks, on turns 2 / 4 / 8 / 16 — never on 1, 3, 5…15.
    assert len(calls) == 4, f"16 messages must not cost 16 checks: {calls}"
    session_row = await _session_by_public_id(public_id)
    assert session_row.status == "active"
    # The counter is the answered-turn counter: 16 answers, 16 increments.
    assert session_row.ai_turn_count == 16

@pytest.mark.asyncio
async def test_the_screened_indices_are_read_from_the_answered_turn_counter(
    public_client, default_agent_id, monkeypatch
):
    """`next_answered_turn` is `ai_turn_count + 1`, so sampling follows answers."""
    sampled_turns: list[int] = []
    real_screen = spam_check.screen_answered_turn

    async def spy(session, message, db):
        # A muted session is skipped before the turn index is read, so the
        # spy records the same turns the real screener would offer.
        sampled_turns.append(spam_check.next_answered_turn(session))
        return await real_screen(session, message, db)

    monkeypatch.setattr("api.v1.endpoints.screen_answered_turn", spy)
    _install_llm(monkeypatch)
    await _configure_agent(default_agent_id)

    for index in range(16):
        await _turn(public_client, default_agent_id, "sess_spam_turns", BENIGN)

    assert sampled_turns == list(range(1, 17)), "every turn is offered"
    session_row = await _session_by_public_id("sess_spam_turns")
    assert session_row.ai_turn_count == 16

# ---------------------------------------------------------- the heuristic

def test_obvious_abuse_is_classified():
    assert spam_check.classify_message(SPAM) is not None
    assert spam_check.classify_message("a" * 24) == "repeated_chars"
    assert spam_check.classify_message("https://x.example.com " * 5) == "url_flood"

def test_normal_questions_are_never_classified():
    for text in (
        BENIGN,
        "你好",
        "How do I reset my password?",
        "你们的发票是怎么开的呢？可以开专票吗？",
    ):
        assert spam_check.classify_message(text) is None, text

def test_short_messages_are_below_the_evidence_floor():
    assert spam_check.classify_message("hi") is None
    assert spam_check.classify_message("") is None
    assert spam_check.classify_message(None) is None  # type: ignore[arg-type]

# ------------------------------------- assertion 4: a hit pauses, and stores only

@pytest.mark.asyncio
async def test_a_spam_hit_pauses_the_session_and_answers_nothing(
    public_client, default_agent_id, monkeypatch
):
    """Assertion 4: the row exists, and no assistant turn was produced."""
    _install_llm(monkeypatch)
    await _configure_agent(default_agent_id)

    public_id = "sess_spam_hit"
    # Turn 1 is never screened, so the visitor always gets a first answer.
    first = await _turn(public_client, default_agent_id, public_id, BENIGN)
    assert first["reply"], "turn 1 is answered"

    # Turn 2 IS screened, and this one hits.
    second = await _turn(public_client, default_agent_id, public_id, SPAM)
    assert second["reply"] == "", "a paused session answers nothing"
    assert second["no_answer_reason"] == "paused"

    session_row = await _session_by_public_id(public_id)
    assert session_row.status == "paused"

    messages = await _messages(public_id)
    assert any(msg.role == "user" and msg.content == SPAM for msg in messages), (
        "the visitor message is stored even though nobody answered it"
    )
    assert [msg.role for msg in messages].count("assistant") == 1, (
        "only the first turn has an assistant message"
    )
    # The paused turn did not advance the answered-turn counter.
    assert session_row.ai_turn_count == 1

@pytest.mark.asyncio
async def test_a_paused_session_stores_messages_but_does_not_answer(
    public_client, default_agent_id, monkeypatch
):
    """Assertion 4, for a session paused by any means (contract C3)."""
    _install_llm(monkeypatch)
    await _configure_agent(default_agent_id)

    public_id = "sess_paused_direct"
    await _turn(public_client, default_agent_id, public_id, BENIGN)

    async with database.AsyncSessionLocal() as db:
        row = await _session_by_public_id(public_id)
        db.add(row)
        row.status = "paused"
        turn_before = row.ai_turn_count
        await db.commit()

    response = await _turn(public_client, default_agent_id, public_id, "暂停后的提问。")
    assert response["reply"] == ""
    assert response["no_answer_reason"] == "paused"

    messages = await _messages(public_id)
    assert any(msg.content == "暂停后的提问。" for msg in messages), "the row exists"
    assert [msg.role for msg in messages].count("assistant") == 1, (
        "no assistant row was written for the paused turn"
    )
    row = await _session_by_public_id(public_id)
    assert row.ai_turn_count == turn_before, "a paused turn is not an answered turn"

@pytest.mark.asyncio
async def test_pausing_is_per_session_not_per_visitor(
    public_client, default_agent_id, monkeypatch
):
    """A new session for the same visitor starts `active` and is answered."""
    _install_llm(monkeypatch)
    await _configure_agent(default_agent_id)

    paused_id = "sess_visitor_paused"
    await _turn(public_client, default_agent_id, paused_id, BENIGN, visitor_id="v9")
    hit = await _turn(public_client, default_agent_id, paused_id, SPAM, visitor_id="v9")
    assert hit["no_answer_reason"] == "paused"

    # Same visitor, brand-new session: not paused.
    fresh_id = "sess_visitor_fresh"
    fresh = await _turn(
        public_client, default_agent_id, fresh_id, BENIGN, visitor_id="v9"
    )
    assert fresh["reply"], "a new session is not paused"
    assert fresh["no_answer_reason"] is None

    fresh_row = await _session_by_public_id(fresh_id)
    assert fresh_row.status == "active"
    assert fresh_row.visitor_id == "v9"
