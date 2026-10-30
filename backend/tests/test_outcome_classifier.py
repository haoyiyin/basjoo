"""Issue #45 acceptance box 3 — a classifier failure never affects live chat.

The hard rule is the acceptance criterion, so the proof is a named test:
`test_classifier_failure_never_affects_live_chat` below monkeypatches the
classifier to raise, runs exactly one scheduler tick, and then asserts

    (a) the tick returns normally (the exception is contained, not re-raised),
    (b) `POST /chat/stream` still answers 200 with a real reply,
    (c) no session row was corrupted — the batch was rolled back as a unit.

Everything else here pins the surrounding guarantees:

* it runs over `closed`/`resolved` sessions only, and only after
  `CLASSIFY_QUIET_MINUTES` of quiet — an active conversation is never touched;
* each batch has its own transaction, so one bad batch cannot roll back or
  corrupt anything the chat path wrote;
* the classifier is a plain callable, so a test injects a fake and no test ever
  calls a real LLM;
* a provider-gated classifier on an install with no LLM key is skipped with ONE
  log line, not a traceback every tick.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

import database
from models import Agent, ChatMessage, ChatSession
from tests.qa_fakes import fake_qa_index  # noqa: F401 — re-exported as a fixture
from services.outcome_classifier import (
    CLASSIFIABLE_STATUSES,
    CLASSIFY_QUIET_MINUTES,
    DEFAULT_CLASSIFIER,
    OUTCOMES,
    Classification,
    SessionSnapshot,
    classify_snapshot,
    provider_configured,
    requires_provider,
)

# ------------------------------------------------------------------ helpers

async def _insert_session(
    agent_id: str,
    public_id: str,
    *,
    status: str = "closed",
    quiet_minutes: int = CLASSIFY_QUIET_MINUTES + 5,
    **kwargs,
) -> str:
    """A finished session that has been quiet long enough to be classifiable."""
    when = datetime.now(timezone.utc) - timedelta(minutes=quiet_minutes)
    async with database.AsyncSessionLocal() as session:
        row = ChatSession(
            agent_id=agent_id,
            session_id=public_id,
            visitor_id=public_id,
            status=status,
            created_at=when,
            updated_at=when,
            **kwargs,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row.id

async def _insert_message(session_db_id: str, role: str, content: str, **kwargs) -> int:
    async with database.AsyncSessionLocal() as session:
        row = ChatMessage(
            session_id=session_db_id, role=role, content=content, **kwargs
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row.id

async def _session_row(session_db_id: str) -> ChatSession:
    async with database.AsyncSessionLocal() as session:
        row = await session.get(ChatSession, session_db_id)
        assert row is not None
        return row

def _scheduler(monkeypatch):
    """The real scheduler class, pointed at this test's database."""
    from services.scheduler import OutcomeClassifierScheduler

    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )
    return OutcomeClassifierScheduler()

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

# ------------------------------------------------------- the shipped classifier

def test_shipped_classifier_is_deterministic_and_needs_no_provider():
    """The default is a plain async callable and declares no provider."""
    assert DEFAULT_CLASSIFIER is classify_snapshot
    assert requires_provider(DEFAULT_CLASSIFIER) is False

def test_outcome_vocabulary_is_the_console_s_reading_order():
    assert OUTCOMES == ("resolved", "abandoned", "escalated", "no-answer")

def test_only_finished_statuses_are_classifiable():
    assert set(CLASSIFIABLE_STATUSES) == {"closed", "resolved"}
    for in_flight in ("active", "taken_over", "paused"):
        assert in_flight not in CLASSIFIABLE_STATUSES

@pytest.mark.asyncio
async def test_human_reply_means_escalated():
    question = "我要人工"
    snapshot = SessionSnapshot(
        session_db_id="sess_x",
        agent_id="agt_x",
        status="closed",
        mode="human",
        human_replied_at=datetime.now(timezone.utc),
        message_count=1,
        messages=(("user", question, False, None),),
    )
    verdict = await classify_snapshot(snapshot)
    assert verdict == Classification(outcome="escalated", topic=question)

@pytest.mark.asyncio
async def test_flagged_last_answer_means_no_answer():
    question = "你们支持哪些付款方式？可以用对公转账吗？"
    snapshot = SessionSnapshot(
        session_db_id="sess_x",
        agent_id="agt_x",
        status="closed",
        mode="ai",
        human_replied_at=None,
        message_count=2,
        messages=(
            ("user", question, False, None),
            ("assistant", "抱歉，我无法回答。", True, "agent"),
        ),
    )
    verdict = await classify_snapshot(snapshot)
    assert verdict.outcome == "no-answer"
    assert verdict.topic == question

@pytest.mark.asyncio
async def test_no_answer_at_all_means_abandoned():
    snapshot = SessionSnapshot(
        session_db_id="sess_y",
        agent_id="agt_y",
        status="closed",
        mode="ai",
        human_replied_at=None,
        message_count=1,
        messages=(("user", "在吗", False, None),),
    )
    verdict = await classify_snapshot(snapshot)
    assert verdict.outcome == "abandoned"

@pytest.mark.asyncio
async def test_a_real_answer_with_no_human_is_resolved():
    snapshot = SessionSnapshot(
        session_db_id="sess_z",
        agent_id="agt_z",
        status="resolved",
        mode="ai",
        human_replied_at=None,
        message_count=2,
        messages=(
            ("user", "退款窗口是多长时间？", False, None),
            ("assistant", "收货后 30 天。", False, "agent"),
        ),
    )
    verdict = await classify_snapshot(snapshot)
    assert verdict.outcome == "resolved"

# ---------------------------------------------------------- the write path

@pytest.mark.asyncio
async def test_a_tick_writes_outcomes_and_topics_on_finished_sessions(
    default_agent_id, monkeypatch
):
    tick = _scheduler(monkeypatch)
    session_db_id = await _insert_session(
        default_agent_id, "sess_classify_me", status="closed"
    )
    await _insert_message(session_db_id, "user", "退款窗口是多长时间？")
    await _insert_message(
        session_db_id, "assistant", "收货后 30 天。", sender_type="agent"
    )

    stats = await tick.classify_pending_sessions()

    assert stats["classified"] == 1
    assert stats["resolved"] == 1
    assert stats["failed"] == 0
    row = await _session_row(session_db_id)
    assert row.outcome == "resolved"
    assert row.topic == "退款窗口是多长时间？"

@pytest.mark.asyncio
async def test_active_sessions_are_never_touched(default_agent_id, monkeypatch):
    """An in-flight conversation is not the classifier's business."""
    tick = _scheduler(monkeypatch)
    active = await _insert_session(
        default_agent_id, "sess_still_active", status="active"
    )
    taken_over = await _insert_session(
        default_agent_id, "sess_taken_over", status="taken_over", mode="human"
    )
    paused = await _insert_session(default_agent_id, "sess_paused", status="paused")

    stats = await tick.classify_pending_sessions()

    assert stats["classified"] == 0
    for session_db_id in (active, taken_over, paused):
        row = await _session_row(session_db_id)
        assert row.outcome is None
        assert row.topic is None

@pytest.mark.asyncio
async def test_a_recently_closed_session_waits_for_the_quiet_period(
    default_agent_id, monkeypatch
):
    tick = _scheduler(monkeypatch)
    fresh = await _insert_session(
        default_agent_id, "sess_just_closed", status="closed", quiet_minutes=1
    )

    stats = await tick.classify_pending_sessions()

    assert stats["classified"] == 0
    assert (await _session_row(fresh)).outcome is None

@pytest.mark.asyncio
async def test_an_already_classified_session_is_not_reclassified(
    default_agent_id, monkeypatch
):
    tick = _scheduler(monkeypatch)
    session_db_id = await _insert_session(
        default_agent_id, "sess_already_done", status="closed", outcome="resolved"
    )

    stats = await tick.classify_pending_sessions()

    assert stats["classified"] == 0
    assert (await _session_row(session_db_id)).outcome == "resolved"

@pytest.mark.asyncio
async def test_a_tick_calls_the_injected_classifier_once_per_candidate(
    default_agent_id, monkeypatch
):
    """The classifier is a plain callable: a fake replaces it and no LLM runs."""
    seen: list[SessionSnapshot] = []

    async def fake(snapshot: SessionSnapshot):
        seen.append(snapshot)
        return Classification(outcome="resolved", topic="injected")

    tick = _scheduler(monkeypatch)
    first = await _insert_session(default_agent_id, "sess_fake_a", status="closed")
    second = await _insert_session(default_agent_id, "sess_fake_b", status="resolved")

    stats = await tick.classify_pending_sessions(classifier=fake)

    assert stats["classified"] == 2
    assert {snapshot.session_db_id for snapshot in seen} == {first, second}
    assert (await _session_row(first)).topic == "injected"

# -------------------------------------------- THE ACCEPTANCE TEST (box 3)

@pytest.mark.asyncio
async def test_classifier_failure_never_affects_live_chat(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """Acceptance box 3, named as the issue names it.

    A broken classifier must not be an outage:

    (a) one scheduler tick returns normally — the exception is contained;
    (b) `/chat/stream` still answers 200 with a real reply;
    (c) no session row was corrupted — the batch rolled back as a unit, so the
        candidate rows keep outcome/topic NULL and their own columns intact.

    The same test also proves the failure never reached the request path: the
    chat turn is served by the real endpoint while the classifier is raising.
    """
    from tests.test_answer_quality import _install_kb_chunks, _install_llm

    tick = _scheduler(monkeypatch)

    # Two finished sessions the tick will try to classify, plus one live session
    # the chat turn will use — all with values a partial write would destroy.
    candidate_a = await _insert_session(
        default_agent_id, "sess_broken_a", status="closed"
    )
    await _insert_message(candidate_a, "user", "退款窗口是多长时间？")
    candidate_b = await _insert_session(
        default_agent_id, "sess_broken_b", status="resolved", topic="原始主题"
    )
    await _insert_message(candidate_b, "assistant", "收货后 30 天。", sender_type="agent")
    live = await _insert_session(
        default_agent_id, "sess_live", status="active", quiet_minutes=0
    )
    await _insert_message(live, "user", "退款窗口是多长时间？")

    async def exploding_classifier(snapshot: SessionSnapshot):
        raise RuntimeError("classifier exploded: model endpoint is down")

    # (a) The tick returns normally. `classify_pending_sessions` never raises.
    stats = await tick.classify_pending_sessions(classifier=exploding_classifier)

    assert isinstance(stats, dict)
    assert stats["failed"] == 1, "the failure is reported, not thrown"
    assert stats["classified"] == 0

    # (c) Nothing was written: the batch is one transaction and it rolled back.
    for session_db_id, original_topic in (
        (candidate_a, None),
        (candidate_b, "原始主题"),
        (live, None),
    ):
        row = await _session_row(session_db_id)
        assert row.outcome is None
        assert row.topic == original_topic
        assert row.status in ("closed", "resolved", "active")

    # The messages the chat path wrote are still exactly what they were.
    async with database.AsyncSessionLocal() as session:
        contents = (
            await session.execute(
                select(ChatMessage.content)
                .where(ChatMessage.session_id == candidate_a)
                .order_by(ChatMessage.id)
            )
        ).scalars().all()
    assert contents == ["退款窗口是多长时间？"]

    # (b) Live chat still answers 200 with the provider's real reply, while the
    # classifier is in its broken state.
    await _install_llm_and_chunks(monkeypatch, _install_llm, _install_kb_chunks)
    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "退款窗口是多长时间？"},
    )
    assert response.status_code == 200, response.text
    events = _parse_sse(response.text)
    content = "".join(
        payload["content"] for name, payload in events if name == "content"
    )
    assert content.strip() == "收货后 30 天。"
    done = [payload for name, payload in events if name == "done"]
    assert len(done) == 1
    assert done[0]["message_id"] is not None, "the answer was persisted"

    # And the chat turn's own session row is intact: the classifier wrote
    # nothing to it and the chat path's own write survived the failure.
    async with database.AsyncSessionLocal() as session:
        from sqlalchemy import func

        chat_session = await session.scalar(
            select(ChatSession).where(
                ChatSession.session_id == done[0]["session_id"]
            )
        )
        assert chat_session is not None
        assert chat_session.status == "active"
        assert chat_session.outcome is None
        message_count = await session.scalar(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.session_id == chat_session.id
            )
        )
    assert message_count == 2, "the visitor turn and the reply both persisted"

async def _install_llm_and_chunks(monkeypatch, install_llm, install_chunks) -> None:
    """A real provider reply (`test_answer_quality`'s own fakes)."""
    from services.answer_quality import DEFAULT_RESTRICTED_REPLY

    text = "收货后 30 天。"
    assert text != DEFAULT_RESTRICTED_REPLY
    install_llm(monkeypatch, text)
    install_chunks(monkeypatch, [("退款政策：收货后 30 天内可无理由退款。", 0.9)])

@pytest.mark.asyncio
async def test_a_mid_batch_failure_rolls_the_whole_batch_back(
    default_agent_id, monkeypatch
):
    """Half-classified is impossible: the batch commits as a unit or not at all."""
    tick = _scheduler(monkeypatch)
    first = await _insert_session(default_agent_id, "sess_half_a", status="closed")
    second = await _insert_session(default_agent_id, "sess_half_b", status="closed")
    third = await _insert_session(default_agent_id, "sess_half_c", status="closed")

    calls = {"count": 0}

    async def fails_on_second(snapshot: SessionSnapshot):
        calls["count"] += 1
        if calls["count"] == 2:
            raise RuntimeError("boom on the second row")
        return Classification(outcome="resolved", topic="written then rolled back")

    stats = await tick.classify_pending_sessions(classifier=fails_on_second)

    assert stats["failed"] == 1
    assert stats["classified"] == 0
    for session_db_id in (first, second, third):
        row = await _session_row(session_db_id)
        assert row.outcome is None
        assert row.topic is None

@pytest.mark.asyncio
async def test_an_unknown_outcome_is_refused_without_touching_the_row(
    default_agent_id, monkeypatch
):
    tick = _scheduler(monkeypatch)
    session_db_id = await _insert_session(
        default_agent_id, "sess_unknown_outcome", status="closed"
    )

    async def nonsense(snapshot: SessionSnapshot):
        return Classification(outcome="delighted", topic="should not be written")

    stats = await tick.classify_pending_sessions(classifier=nonsense)

    assert stats["classified"] == 0
    row = await _session_row(session_db_id)
    assert row.outcome is None
    assert row.topic is None

@pytest.mark.asyncio
async def test_a_keyless_install_skips_a_model_backed_classifier_and_logs_once(
    default_agent_id, monkeypatch, caplog
):
    """No LLM configured: one log line, no traceback, no exception per tick."""
    tick = _scheduler(monkeypatch)
    await _insert_session(default_agent_id, "sess_no_provider", status="closed")

    # Make every agent keyless, the way a fresh install is.
    async with database.AsyncSessionLocal() as session:
        await session.execute(
            update(Agent).values(api_key=None)
        )
        await session.commit()

        agents = (await session.execute(select(Agent))).scalars().all()
    assert all(provider_configured(agent) is False for agent in agents)

    async def model_classifier(snapshot: SessionSnapshot):
        raise AssertionError("a provider-gated classifier must not be called")

    model_classifier.requires_provider = True
    assert requires_provider(model_classifier) is True

    caplog.set_level(logging.INFO, logger="services.scheduler")
    first = await tick.classify_pending_sessions(classifier=model_classifier)
    second = await tick.classify_pending_sessions(classifier=model_classifier)

    assert first["skipped"] == 1
    assert second["skipped"] == 1
    assert first["failed"] == second["failed"] == 0

    skip_lines = [
        record for record in caplog.records if "skipped" in record.getMessage().lower()
    ]
    assert len(skip_lines) == 1, "the reason is logged once, not every tick"
    for record in caplog.records:
        assert record.levelno < logging.ERROR, "no traceback per tick"
