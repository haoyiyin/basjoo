"""Issue #42 — answer quality: the ≥15-char rule, confidence, fallback detection.

The assertions are on persisted rows and API bodies, not on helper return
values, except the unit block at the top which pins the rule itself (acceptance
criterion 2 asks for the rule to be *unit*-tested).

The SiteGPT rule, restated because every test below depends on it:

    unanswered = is_real_question(question) AND
                 (nothing was retrieved OR the answer is the fallback sentence)
"""

import json

import pytest
from sqlalchemy import select, update

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession
from services import answer_quality
from services.answer_quality import (
    DEFAULT_EMPTY_ANSWER_REPLY,
    DEFAULT_RESTRICTED_REPLY,
    UNANSWERED_MIN_QUESTION_CHARS,
    compute_confidence,
    is_real_question,
    looks_like_fallback,
)
from tests.qa_fakes import fake_qa_index, recording_embeddings

REAL_QUESTION = "你们的退款窗口是多长时间？可以开专票吗？"
REAL_ANSWER = "退款窗口为收货后 30 天，可以开具增值税专用发票。"
KB_CHUNK = "退款政策：收货后 30 天内可无理由退款，支持开具增值税专用发票。"

# --------------------------------------------------------------- the rule

def test_short_greetings_are_never_real_questions():
    """Assertion 1: 'hi' / '你好' / 'thanks' are chatter, not a question."""
    assert UNANSWERED_MIN_QUESTION_CHARS == 15
    assert is_real_question("hi") is False
    assert is_real_question("你好") is False  # 2 characters
    assert is_real_question("thanks") is False
    assert is_real_question("") is False
    assert is_real_question(None) is False

def test_fifteen_character_question_is_real():
    """Assertion 1: exactly 15 characters is enough, 14 is not."""
    assert is_real_question("a" * 14) is False
    assert is_real_question("a" * 15) is True
    assert is_real_question("退款窗口是多长时间呢") is False  # 10 characters
    assert is_real_question("请问你们的退款窗口是多长时间呢") is True  # 16 characters
    assert is_real_question(REAL_QUESTION) is True

def test_whitespace_does_not_count_toward_the_length():
    """Assertion 1: padding with spaces must not promote a short message."""
    padded = "  hi        there        "  # 9 non-whitespace characters
    assert len(padded) >= 15
    assert is_real_question(padded) is False
    assert is_real_question("a" * 7 + " " * 30 + "b" * 7) is False
    assert is_real_question("a" * 8 + " " * 30 + "b" * 7) is True

def test_confidence_is_the_best_signal_and_none_without_retrieval():
    """`None` means "no signal"; it is never 0.0."""
    assert compute_confidence(kb_scores=[], qa_scores=[]) is None
    assert compute_confidence(kb_scores=[0.42, 0.31], qa_scores=[]) == 0.42
    # A curated hit is a stronger signal than a chunk: it wins outright.
    assert compute_confidence(kb_scores=[0.9], qa_scores=[0.81]) == 0.81
    assert compute_confidence(kb_scores=[], qa_scores=[0.77, 0.8]) == 0.8
    # Garbage entries are ignored rather than crashing the chat path.
    assert compute_confidence(kb_scores=[None, "x"], qa_scores=[]) is None

def test_fallback_detection_covers_configured_and_builtin_replies():
    assert looks_like_fallback("", "custom reply") is True
    assert looks_like_fallback(None, None) is True
    assert looks_like_fallback(DEFAULT_RESTRICTED_REPLY, None) is True
    assert looks_like_fallback(DEFAULT_EMPTY_ANSWER_REPLY, None) is True
    assert looks_like_fallback("  自定义 兜底  ", "自定义 兜底") is True
    assert looks_like_fallback("CUSTOM REPLY", "custom reply") is True
    assert looks_like_fallback(REAL_ANSWER, "custom reply") is False
    assert answer_quality.DEFAULT_RESTRICTED_REPLY == DEFAULT_RESTRICTED_REPLY

# ------------------------------------------------------------- chat paths

class _ScriptedLLM:
    """Provider stub: yields the scripted text, word by word."""

    def __init__(self, text: str) -> None:
        self._text = text

    async def chat_completion(self, **kwargs):
        for word in self._text.split():
            yield word + " "

    def get_last_usage(self):
        return None

def _install_llm(monkeypatch, text: str) -> None:
    monkeypatch.setattr(
        "api.v1.endpoints.get_llm_service", lambda **kwargs: _ScriptedLLM(text)
    )

def _install_kb_chunks(monkeypatch, chunks: list[tuple[str, float]]):
    """KB retrieval seam: fixed chunks and scores, no Qdrant and no embeddings."""

    class FakeRetriever:
        async def retrieve(self, **kwargs):
            return [
                {
                    "text": text,
                    "doc_id": f"doc_{index}",
                    "chunk_index": index,
                    "score": score,
                    "filename": "refund.txt",
                    "source_type": "file",
                    "source_url": "",
                    "source_title": "refund.txt",
                }
                for index, (text, score) in enumerate(chunks)
            ]

    monkeypatch.setattr("api.v1.endpoints.KbRetrievalService", FakeRetriever)

async def _set_restricted_reply(agent_id: str, value: str | None) -> None:
    async with database.AsyncSessionLocal() as session:
        await session.execute(
            update(Agent).where(Agent.id == agent_id).values(restricted_reply=value)
        )
        await session.commit()

async def _ready_agent(default_agent_id: str) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key("sk-test-answer-quality")
        await session.commit()
    return default_agent_id

def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for raw_event in body.split("\n\n"):
        if not raw_event.strip():
            continue
        name = None
        payload: list[str] = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload.append(line.split(":", 1)[1].strip())
        if name is None:
            continue
        events.append((name, json.loads("\n".join(payload))))
    return events

async def _stream_chat(public_client, agent_id: str, message: str) -> list[tuple[str, dict]]:
    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": agent_id, "message": message},
    )
    assert response.status_code == 200, response.text
    return _parse_sse(response.text)

async def _last_assistant_message(session_public_id: str) -> ChatMessage:
    async with database.AsyncSessionLocal() as session:
        message = await session.scalar(
            select(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatSession.session_id == session_public_id,
                ChatMessage.role == "assistant",
            )
            .order_by(ChatMessage.id.desc())
            .limit(1)
        )
        assert message is not None, "the exchange must be persisted"
        return message

@pytest.mark.asyncio
async def test_fallback_answer_is_flagged_without_operator_action(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 2: the agent's own `restricted_reply` marks the row unanswered."""
    await _ready_agent(default_agent_id)
    await _set_restricted_reply(default_agent_id, "这个问题我暂时无法回答，请联系人工。")
    _install_llm(monkeypatch, "这个问题我暂时无法回答，请联系人工。")
    _install_kb_chunks(monkeypatch, [(KB_CHUNK, 0.82)])

    events = await _stream_chat(public_client, default_agent_id, REAL_QUESTION)
    done = dict(events)["done"]
    assert done["message_id"] is not None

    message = await _last_assistant_message(done["session_id"])
    assert message.is_unanswered is True, "the fallback reply is never a real answer"
    # Retrieval did happen, so the score is still recorded — the flag is about
    # the answer, not about the retrieval.
    assert message.confidence == pytest.approx(0.82)

@pytest.mark.asyncio
async def test_real_answer_keeps_the_retrieval_score_as_confidence(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 3: confidence equals the retrieval score; not unanswered."""
    await _ready_agent(default_agent_id)
    _install_llm(monkeypatch, REAL_ANSWER)
    _install_kb_chunks(monkeypatch, [(KB_CHUNK, 0.73)])

    events = await _stream_chat(public_client, default_agent_id, REAL_QUESTION)
    done = dict(events)["done"]

    message = await _last_assistant_message(done["session_id"])
    assert message.confidence == pytest.approx(0.73)
    assert message.is_unanswered is False
    assert REAL_ANSWER.split()[0] in (message.content or "")

@pytest.mark.asyncio
async def test_zero_retrieval_marks_a_real_question_unanswered(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 4: nothing retrieved + a real answer is still unanswered."""
    await _ready_agent(default_agent_id)
    _install_llm(monkeypatch, REAL_ANSWER)
    _install_kb_chunks(monkeypatch, [])

    events = await _stream_chat(public_client, default_agent_id, REAL_QUESTION)
    done = dict(events)["done"]

    message = await _last_assistant_message(done["session_id"])
    assert message.confidence is None, "no retrieval is 'no signal', not 0.0"
    assert message.is_unanswered is True

@pytest.mark.asyncio
async def test_short_greeting_is_not_unanswered(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Assertion 5: 'hi' with zero retrieval is chatter, never a queue row."""
    await _ready_agent(default_agent_id)
    _install_llm(monkeypatch, "你好！有什么可以帮你的吗？")
    _install_kb_chunks(monkeypatch, [])

    events = await _stream_chat(public_client, default_agent_id, "hi")
    done = dict(events)["done"]

    message = await _last_assistant_message(done["session_id"])
    assert message.is_unanswered is False
    assert message.confidence is None

# ---------------------------------------------------------- the admin queue

async def _seed_unanswered(
    agent_id: str, public_session_id: str, question: str, answer: str
) -> int:
    """Insert a user/assistant pair already flagged unanswered; return msg id."""
    async with database.AsyncSessionLocal() as session:
        session_row = ChatSession(
            agent_id=agent_id, session_id=public_session_id, status="active"
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)
        session.add(
            ChatMessage(session_id=session_row.id, role="user", content=question)
        )
        assistant = ChatMessage(
            session_id=session_row.id,
            role="assistant",
            content=answer,
            sender_type="agent",
            is_unanswered=True,
        )
        session.add(assistant)
        await session.commit()
        await session.refresh(assistant)
        return assistant.id

@pytest.mark.asyncio
async def test_unanswered_queue_counts_occurrences_in_sql(
    client, default_agent_id, fake_qa_index
):
    """Assertion 6: the same question asked twice reports occurrences == 2."""
    question = "你们的发票是怎么开的？可以开增值税专用发票吗？"
    first = await _seed_unanswered(
        default_agent_id, "sess_unans_a", question, DEFAULT_EMPTY_ANSWER_REPLY
    )
    # Different casing and spacing must collapse to the same normalised key.
    second = await _seed_unanswered(
        default_agent_id,
        "sess_unans_b",
        "  你们的发票是怎么开的？可以开增值税专用发票吗？  ",
        DEFAULT_EMPTY_ANSWER_REPLY,
    )

    response = await client.get("/api/v1/admin/sessions/unanswered")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    rows = {row["message_id"]: row for row in body["items"]}
    assert set(rows) == {first, second}
    for row in rows.values():
        assert row["occurrences"] == 2, "GROUP BY the normalised question"
        assert row["question"] == question, "the question is the user message"
        assert row["answer"] == DEFAULT_EMPTY_ANSWER_REPLY
        assert row["confidence"] is None
        assert row["session_id"].startswith("sess_unans_")

    # Ordering: newest first.
    created = [row["created_at"] for row in body["items"]]
    assert created == sorted(created, reverse=True)

@pytest.mark.asyncio
async def test_since_window_defaults_to_30_days_and_rejects_garbage(
    client, default_agent_id, fake_qa_index
):
    """`since` is ISO-8601; the default window is 30 days; bad input is a 400."""
    from datetime import datetime, timedelta, timezone
    from urllib.parse import quote

    recent = await _seed_unanswered(
        default_agent_id,
        "sess_since_recent",
        "你们最近上线的这个功能是怎么收费的呢？",
        DEFAULT_EMPTY_ANSWER_REPLY,
    )
    old_id = await _seed_unanswered(
        default_agent_id,
        "sess_since_old",
        "你们去年上线的那个功能是怎么收费的呢？",
        DEFAULT_EMPTY_ANSWER_REPLY,
    )
    async with database.AsyncSessionLocal() as session:
        await session.execute(
            update(ChatMessage)
            .where(ChatMessage.id == old_id)
            .values(created_at=datetime.now(timezone.utc) - timedelta(days=45))
        )
        await session.commit()

    # Default window (30 days) excludes the 45-day-old row.
    defaulted = await client.get("/api/v1/admin/sessions/unanswered")
    assert defaulted.status_code == 200, defaulted.text
    ids = [row["message_id"] for row in defaulted.json()["items"]]
    assert recent in ids
    assert old_id not in ids

    # An explicit wide window brings it back.
    wide_since = quote(
        (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    )
    wide = await client.get(
        f"/api/v1/admin/sessions/unanswered?since={wide_since}"
    )
    assert wide.status_code == 200, wide.text
    assert old_id in [row["message_id"] for row in wide.json()["items"]]

    # A narrow window excludes both.
    narrow_since = quote(
        (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    )
    narrow = await client.get(
        f"/api/v1/admin/sessions/unanswered?since={narrow_since}"
    )
    assert narrow.status_code == 200
    assert narrow.json()["items"] == []

    # An unencoded `+08:00` arrives as a space; the offset must be restored
    # instead of turning a valid timestamp into a 400.
    raw_plus = (
        datetime.now(timezone.utc) - timedelta(days=1)
    ).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    raw = await client.get(f"/api/v1/admin/sessions/unanswered?since={raw_plus}")
    assert raw.status_code == 200, raw.text
    assert recent in [row["message_id"] for row in raw.json()["items"]]

    # Garbage is a 400, never a 500.
    bad = await client.get("/api/v1/admin/sessions/unanswered?since=not-a-date")
    assert bad.status_code == 400, bad.text

@pytest.mark.asyncio
async def test_unanswered_row_without_a_user_message_still_lists(
    client, default_agent_id, fake_qa_index
):
    """A flagged assistant message with no preceding question is not dropped."""
    async with database.AsyncSessionLocal() as session:
        session_row = ChatSession(
            agent_id=default_agent_id, session_id="sess_orphan", status="active"
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)
        orphan = ChatMessage(
            session_id=session_row.id,
            role="assistant",
            content=DEFAULT_EMPTY_ANSWER_REPLY,
            sender_type="agent",
            is_unanswered=True,
        )
        session.add(orphan)
        await session.commit()
        await session.refresh(orphan)
        orphan_id = orphan.id

    response = await client.get("/api/v1/admin/sessions/unanswered")
    assert response.status_code == 200, response.text
    rows = {row["message_id"]: row for row in response.json()["items"]}
    assert orphan_id in rows, "a NULL grouping key must not hide the row"
    assert rows[orphan_id]["question"] == ""
    assert rows[orphan_id]["occurrences"] == 1

@pytest.mark.asyncio
async def test_dismiss_removes_the_row_but_keeps_the_message(
    client, default_agent_id, fake_qa_index
):
    """Assertion 7: dismiss takes the row out of the queue, deletes nothing."""
    message_id = await _seed_unanswered(
        default_agent_id,
        "sess_unans_dismiss",
        "你们的客服电话是多少？工作时间是什么时候？",
        DEFAULT_EMPTY_ANSWER_REPLY,
    )

    listed = await client.get("/api/v1/admin/sessions/unanswered")
    assert [row["message_id"] for row in listed.json()["items"]] == [message_id]

    dismissed = await client.post(
        f"/api/v1/admin/sessions/unanswered/{message_id}:dismiss"
    )
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json() == {"dismissed": True}

    after = await client.get("/api/v1/admin/sessions/unanswered")
    assert after.json()["items"] == []
    assert after.json()["total"] == 0

    async with database.AsyncSessionLocal() as session:
        message = await session.get(ChatMessage, message_id)
        assert message is not None, "the transcript is never edited by triage"
        assert message.is_unanswered is False
        assert message.content == DEFAULT_EMPTY_ANSWER_REPLY

@pytest.mark.asyncio
async def test_low_confidence_filter_selects_sessions_not_messages(
    client, default_agent_id, fake_qa_index
):
    """Assertion 8: `low_confidence=true` narrows the list; unfiltered is intact."""
    await _seed_unanswered(
        default_agent_id,
        "sess_conf_weak",
        "你们的退款窗口是多长时间？可以开专票吗？",
        "退款窗口 30 天。",
    )
    await _seed_unanswered(
        default_agent_id,
        "sess_conf_strong",
        "你们支持哪些付款方式？可以开专票吗？",
        "支持微信、支付宝和银行转账。",
    )

    async with database.AsyncSessionLocal() as session:
        weak_session = await session.scalar(
            select(ChatSession).where(ChatSession.session_id == "sess_conf_weak")
        )
        strong_session = await session.scalar(
            select(ChatSession).where(ChatSession.session_id == "sess_conf_strong")
        )
        assert weak_session and strong_session
        await session.execute(
            update(ChatMessage)
            .where(
                ChatMessage.session_id == weak_session.id,
                ChatMessage.role == "assistant",
            )
            .values(confidence=0.21, is_unanswered=False)
        )
        await session.execute(
            update(ChatMessage)
            .where(
                ChatMessage.session_id == strong_session.id,
                ChatMessage.role == "assistant",
            )
            .values(confidence=0.88, is_unanswered=False)
        )
        await session.commit()

    unfiltered = await client.get("/api/v1/admin/sessions?limit=50")
    assert unfiltered.status_code == 200, unfiltered.text
    all_ids = {item["session_id"] for item in unfiltered.json()["items"]}
    assert {"sess_conf_weak", "sess_conf_strong"} <= all_ids

    filtered = await client.get("/api/v1/admin/sessions?low_confidence=true&limit=50")
    assert filtered.status_code == 200, filtered.text
    weak_ids = {item["session_id"] for item in filtered.json()["items"]}
    assert "sess_conf_weak" in weak_ids
    assert "sess_conf_strong" not in weak_ids
    assert weak_ids <= all_ids

    # The unfiltered result is unchanged by having asked the filtered question.
    again = await client.get("/api/v1/admin/sessions?limit=50")
    assert {item["session_id"] for item in again.json()["items"]} == all_ids
    assert again.json()["total"] == unfiltered.json()["total"]

    unanswered_only = await client.get("/api/v1/admin/sessions?unanswered=true&limit=50")
    assert unanswered_only.status_code == 200
    # Both seeded rows were un-flagged above, so the queue filter matches none.
    assert unanswered_only.json()["items"] == []

@pytest.mark.asyncio
async def test_unanswered_queue_404s_for_another_workspace(
    client, default_agent_id, fake_qa_index
):
    """Assertion 9: a foreign session/message is a 404, never a 403 leak."""
    from models import Workspace

    async with database.AsyncSessionLocal() as session:
        other = Workspace(name="Other Workspace", owner_email="other@example.com")
        session.add(other)
        await session.commit()
        await session.refresh(other)
        foreign_agent = Agent(
            workspace_id=other.id,
            name="Foreign Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(foreign_agent)
        await session.commit()
        await session.refresh(foreign_agent)
        foreign_agent_id = foreign_agent.id

    foreign_message_id = await _seed_unanswered(
        foreign_agent_id,
        "sess_foreign",
        "这个会话属于另一个工作空间，不该被看到。",
        DEFAULT_EMPTY_ANSWER_REPLY,
    )

    # An explicit foreign agent id is refused outright.
    response = await client.get(
        f"/api/v1/admin/sessions/unanswered?agent_id={foreign_agent_id}"
    )
    assert response.status_code == 403, response.text

    # Without the filter the foreign rows are not in the list either.
    listing = await client.get("/api/v1/admin/sessions/unanswered")
    assert listing.status_code == 200
    assert all(
        row["session_id"] != "sess_foreign" for row in listing.json()["items"]
    )

    # Dismissing a foreign message answers 404 — existence is never confirmed —
    # and leaves the row exactly as it was.
    dismissed = await client.post(
        f"/api/v1/admin/sessions/unanswered/{foreign_message_id}:dismiss"
    )
    assert dismissed.status_code == 404, dismissed.text
    assert dismissed.json()["detail"] == "Message not found"
    async with database.AsyncSessionLocal() as session:
        still = await session.get(ChatMessage, foreign_message_id)
        assert still is not None and still.is_unanswered is True

@pytest.mark.asyncio
async def test_from_message_rejects_a_non_assistant_message(
    client, default_agent_id, fake_qa_index, recording_embeddings
):
    """Assertion 9: a user message is not an answer, so it is a 400."""
    async with database.AsyncSessionLocal() as session:
        session_row = ChatSession(
            agent_id=default_agent_id, session_id="sess_role_guard", status="active"
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)
        user_message = ChatMessage(
            session_id=session_row.id, role="user", content=REAL_QUESTION
        )
        session.add(user_message)
        await session.commit()
        await session.refresh(user_message)
        user_message_id = user_message.id

    response = await client.post(
        f"/api/v1/admin/qa/from-message/{user_message_id}"
    )
    assert response.status_code == 400, response.text
