"""Issue #60 — the scripted (LLM-free) answer source, wired into both chat endpoints.

Restated once, because every assertion below hangs off it:

    agent.fallback_mode = off | llm | keyword | llm_then_keyword   (default off)

    off               today, byte for byte. Quota spent -> 429 (unless #44's
                      `fallback_model` is configured, exactly as before).
    llm               today's #44 path; the keyword matcher is never consulted.
    keyword           keyword match only; `fallback_model` is ignored entirely.
    llm_then_keyword  #44 wins when it can serve; otherwise the matcher runs.

    A keyword MISS returns the operator's `restricted_reply` as a normal 200
    assistant turn — never 429 — and is persisted with `mode="scripted"`.
    A scripted turn costs 0 tokens but still counts as one answered turn.

The three invariants this file exists to prove, each in its own test:

1. zero provider calls on the scripted path — `get_llm_service` raises if it is
   even built, and `DocumentParser.embed_texts` counts its calls;
2. a quota miss is HTTP 200 + `restricted_reply`, not 429 (keyword modes only);
3. a keyless agent keeps today's 400/`API_KEY_MISSING` in EVERY mode.
"""

import json
import uuid
from typing import Any, AsyncIterator, Dict, Optional

import pytest
from sqlalchemy import select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession, QaItem, WorkspaceQuota

# A distinct string so "the answer came from the pair" is provable.
PAIR_QUESTION = "你们的退款窗口是多长时间？"
PAIR_ANSWER = "PAIR_ANSWER 收货后 30 天内可无理由退款，可以开具增值税专用发票。"
PAIR_KEYWORDS = ["退款", "退款窗口"]

# Two messages: one the keyword matcher can serve and one it cannot.
MATCHING_MESSAGE = "请问我要退款，退款窗口是多长时间呢？"
NON_MATCHING_MESSAGE = "你们周六上班吗？我想预约一个演示。"

OPERATOR_RESTRICTED = "这个问题我先帮您转给人工同事。"


# ------------------------------------------------------------------ helpers


def _parse_sse(body: str) -> list[tuple[str, Dict[str, Any]]]:
    events: list[tuple[str, Dict[str, Any]]] = []
    for raw_event in body.split("\n\n"):
        if not raw_event.strip():
            continue
        name: Optional[str] = None
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


class _ProviderExploded(AssertionError):
    """Raised when the scripted path touches a provider at all."""


class _NeverCalledLLM:
    """A provider stub that fails the test if it is ever built."""

    async def chat_completion(self, **kwargs: Any) -> AsyncIterator[str]:
        raise _ProviderExploded("the LLM was called on the scripted path")
        yield ""  # pragma: no cover

    def get_last_usage(self) -> Optional[Dict[str, int]]:
        raise _ProviderExploded("the LLM was called on the scripted path")


class _FailingProvider:
    """Every `chat_completion` raises: the provider is hard-down (AC2)."""

    async def chat_completion(self, **kwargs: Any) -> AsyncIterator[str]:
        raise RuntimeError("provider is down")
        yield ""  # pragma: no cover

    def get_last_usage(self) -> Optional[Dict[str, int]]:
        return None


class _ScriptedProvider:
    """A provider that always answers with `text` (a normal, non-scripted turn)."""

    def __init__(self, text: str) -> None:
        self._text = text

    async def chat_completion(self, **kwargs: Any) -> AsyncIterator[str]:
        for word in self._text.split():
            yield word + " "

    def get_last_usage(self) -> Optional[Dict[str, int]]:
        return None


def _forbid_provider(monkeypatch: Any) -> None:
    """Make building an LLM service a hard failure (AC1's zero-call proof)."""

    def factory(**kwargs: Any) -> Any:
        raise _ProviderExploded(
            f"get_llm_service was called with model={kwargs.get('model')!r}"
        )

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", factory)


def _count_embeddings(monkeypatch: Any) -> list[list[str]]:
    """Record every `DocumentParser.embed_texts` call; assert it stays empty."""
    calls: list[list[str]] = []

    async def fake_embed_texts(
        self: Any, texts: Any, model: Any = None, *args: Any, **kwargs: Any
    ) -> list[list[float]]:
        recorded = list(texts)
        calls.append(recorded)
        raise _ProviderExploded(f"embed_texts was called with {recorded!r}")

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )
    return calls


def _install_provider(monkeypatch: Any, llm: Any) -> list[Any]:
    """Install a stub and return the list of `get_llm_service` call kwargs."""
    calls: list[Any] = []

    def factory(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return llm

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", factory)
    return calls


async def _configure_agent(
    agent_id: str,
    *,
    fallback_mode: Optional[str] = None,
    fallback_model: Optional[str] = None,
    fallback_key: Optional[str] = None,
    restricted_reply: Optional[str] = None,
    primary_key: str = "sk-scripted-test",
) -> None:
    """Set the switches this issue adds (and the #44 ones they interact with)."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key(primary_key) if primary_key else None
        agent.fallback_model = fallback_model
        agent.fallback_api_key = (
            encrypt_api_key(fallback_key) if fallback_key else None
        )
        # `None` means "leave the column alone" so the caller can prove the
        # upgrade-safe default rather than set it explicitly.
        if fallback_mode is not None:
            agent.fallback_mode = fallback_mode
        agent.restricted_reply = restricted_reply
        await session.commit()


async def _seed_pair(kb_id: str, keywords: Optional[list[str]] = None) -> str:
    """Insert one curated pair the keyword path can serve."""
    async with database.AsyncSessionLocal() as session:
        pair = QaItem(
            kb_id=kb_id,
            question=PAIR_QUESTION,
            answer=PAIR_ANSWER,
            enabled=True,
            hits=0,
            keywords=PAIR_KEYWORDS if keywords is None else keywords,
        )
        session.add(pair)
        await session.commit()
        await session.refresh(pair)
        return pair.id


async def _pair_row(qa_id: str) -> QaItem:
    async with database.AsyncSessionLocal() as session:
        pair = await session.get(QaItem, qa_id)
        assert pair is not None
        return pair


async def _max_per_day() -> int:
    async with database.AsyncSessionLocal() as session:
        workspace_id = await session.scalar(select(Agent.workspace_id).limit(1))
        quota = await session.scalar(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
        )
        assert quota is not None
        return int(quota.max_messages_per_day or 0)


async def _set_used_today(value: int) -> None:
    from datetime import datetime, timezone

    async with database.AsyncSessionLocal() as session:
        workspace_id = await session.scalar(select(Agent.workspace_id).limit(1))
        quota = await session.scalar(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
        )
        assert quota is not None
        quota.used_messages_today = value
        quota.last_message_reset = datetime.now(timezone.utc)
        await session.commit()


async def _exhaust_quota() -> int:
    """Spend the whole daily allowance and return the cap."""
    cap = await _max_per_day()
    await _set_used_today(cap)
    return cap


async def _assistant_rows(session_public_id: str) -> list[ChatMessage]:
    async with database.AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(ChatMessage)
                .join(ChatSession, ChatSession.id == ChatMessage.session_id)
                .where(
                    ChatSession.session_id == session_public_id,
                    ChatMessage.role == "assistant",
                )
                .order_by(ChatMessage.id.asc())
            )
        ).scalars().all()
        return list(rows)


async def session_pair(kb_id: str) -> QaItem:
    """The seeded pair for a KB (one per test)."""
    async with database.AsyncSessionLocal() as session:
        pair = await session.scalar(select(QaItem).where(QaItem.kb_id == kb_id))
        assert pair is not None, "the test must have seeded a pair"
        return pair


async def _stream(
    public_client: Any, agent_id: str, message: str
) -> list[tuple[str, Dict[str, Any]]]:
    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": agent_id, "message": message},
    )
    assert response.status_code == 200, response.text
    return _parse_sse(response.text)


def _content(events: list[tuple[str, Dict[str, Any]]]) -> str:
    return "".join(
        payload.get("content", "")
        for name, payload in events
        if name in ("content", "thinking")
    )


def _done(events: list[tuple[str, Dict[str, Any]]]) -> Dict[str, Any]:
    done_events = [payload for name, payload in events if name == "done"]
    assert len(done_events) == 1, events
    return done_events[0]


# =====================================================================
# AC1 — the scripted path answers with ZERO provider calls
# =====================================================================


@pytest.mark.asyncio
async def test_keyword_quota_hit_answers_the_pair_with_no_provider_call(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC1: quota spent + a matching message -> the pair's text, 200, no provider.

    The two monkeypatches are the proof, not decoration: `get_llm_service` raises
    on construction and `DocumentParser.embed_texts` records every call (both the
    `QaService.search` and `KbRetrievalService.retrieve` seams embed through it).
    A single call to either fails the test by name.
    """
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    qa_id = await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    cap = await _exhaust_quota()

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert [name for name, _ in events].count("error") == 0, events
    # The pair's own text answered, and the restricted reply did not.
    assert PAIR_ANSWER in _content(events), _content(events)
    assert OPERATOR_RESTRICTED not in _content(events)
    assert done["message_id"] is not None
    assert done["mode"] == "scripted", done
    assert done["matched_by"] == "keyword", done

    # Zero provider calls, asserted directly.
    assert embed_calls == [], f"the semantic paths embedded: {embed_calls}"
    rows = await _assistant_rows(done["session_id"])
    assert len(rows) == 1
    assert rows[0].content == PAIR_ANSWER
    assert rows[0].mode == "scripted"

    # Quota accounting: unchanged — one answered turn, even though it cost 0 tokens.
    async with database.AsyncSessionLocal() as session:
        workspace_id = await session.scalar(select(Agent.workspace_id).limit(1))
        quota = await session.scalar(
            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
        )
        assert quota is not None
        assert int(quota.used_messages_today) == cap + 1


@pytest.mark.asyncio
async def test_non_stream_chat_also_serves_the_pair_without_a_provider(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC1 on `/chat` (the blocking endpoint): same zero-provider guarantee."""
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _exhaust_quota()

    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )

    # A quota miss is 200, not 429 — this is the blocking route's status code.
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reply"] == PAIR_ANSWER
    assert body["mode"] == "scripted", body
    assert body["matched_by"] == "keyword", body
    assert body["message_id"] is not None
    assert embed_calls == [], f"the semantic paths embedded: {embed_calls}"


# =====================================================================
# AC2 — a provider hard-failure still answers a curated pair
# =====================================================================


@pytest.mark.asyncio
async def test_provider_failure_answers_a_matching_pair(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC2: every provider call raises -> a matching message is still answered."""
    _install_provider(monkeypatch, _FailingProvider())
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _set_used_today(0)

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert PAIR_ANSWER in _content(events), _content(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] == "keyword", done
    # The stream's provider-failure site has NEVER persisted an assistant row
    # (`message_id` is None there, unchanged by this issue); the hit counter is
    # still bumped, because the visitor really did receive the pair.
    assert done["message_id"] is None, done
    pair = (
        await session_pair(bound_kb_id)
    )
    assert pair.hits == 1, "a served pair is counted even at a failure site"
    assert pair.last_hit_at is not None


@pytest.mark.asyncio
async def test_provider_failure_with_a_non_matching_message_gets_the_restricted_reply(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC2's other half: no match -> the operator's restricted reply."""
    _install_provider(monkeypatch, _FailingProvider())
    # The semantic paths still ran in this scenario (a real turn, quota intact),
    # so their embedders are stubbed rather than left to reach the network.
    embed_calls = _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _set_used_today(0)

    events = await _stream(public_client, default_agent_id, NON_MATCHING_MESSAGE)
    done = _done(events)

    assert OPERATOR_RESTRICTED in _content(events), _content(events)
    assert PAIR_ANSWER not in _content(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] is None, done
    # A non-matching message never touches the pair's counter.
    pair = await session_pair(bound_kb_id)
    assert pair.hits == 0
    assert embed_calls, "the normal semantic path is expected to have embedded"


@pytest.mark.asyncio
async def test_non_stream_provider_failure_answers_a_matching_pair(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC2 on `/chat`: a provider exception is a scripted serving site too."""
    _install_provider(monkeypatch, _FailingProvider())
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _set_used_today(0)

    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reply"] == PAIR_ANSWER
    assert body["mode"] == "scripted"
    assert body["matched_by"] == "keyword"
    assert body["message_id"] is not None


# =====================================================================
# AC3 — a miss persists exactly one assistant row, no extra
# =====================================================================


@pytest.mark.asyncio
async def test_quota_miss_is_200_restricted_reply_and_one_assistant_row(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC3: the miss is a 200 turn carrying the sentence, and nothing else."""
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _exhaust_quota()

    # Streaming: the wall is gone, the sentence is the answer.
    events = await _stream(public_client, default_agent_id, NON_MATCHING_MESSAGE)
    done = _done(events)
    assert [name for name, _ in events].count("error") == 0, events
    assert OPERATOR_RESTRICTED in _content(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] is None, done
    assert embed_calls == []

    rows = await _assistant_rows(done["session_id"])
    assert len(rows) == 1, "exactly one assistant turn, no extra row"
    assert rows[0].content == OPERATOR_RESTRICTED
    assert rows[0].mode == "scripted"

    # Blocking: 200 + the same sentence, never 429.
    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": NON_MATCHING_MESSAGE},
    )
    assert blocking.status_code == 200, blocking.text
    body = blocking.json()
    assert body["reply"] == OPERATOR_RESTRICTED
    assert body["mode"] == "scripted"


@pytest.mark.asyncio
async def test_a_miss_does_not_inflate_the_pair_hits_counter(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC5's converse: only a SERVED pair is counted."""
    _forbid_provider(monkeypatch)
    qa_id = await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="keyword")
    await _exhaust_quota()

    await _stream(public_client, default_agent_id, NON_MATCHING_MESSAGE)

    assert (await _pair_row(qa_id)).hits == 0


# =====================================================================
# AC4 — `mode: scripted` on the wire and on the row; `ai` on a normal turn
# =====================================================================


@pytest.mark.asyncio
async def test_a_normal_turn_still_reports_mode_ai(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC4 contrast: an ordinary model answer is `mode: "ai"`, `matched_by: null`."""
    _install_provider(monkeypatch, _ScriptedProvider("NORMAL_ANSWER 这是模型回答。"))
    # A normal turn runs the semantic paths; keep them off the network.
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="keyword")
    await _set_used_today(0)

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert "NORMAL_ANSWER" in _content(events)
    assert done["mode"] == "ai", done
    assert done["matched_by"] is None, done

    rows = await _assistant_rows(done["session_id"])
    assert len(rows) == 1
    assert rows[0].mode == "ai"

    # The blocking endpoint agrees.
    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )
    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "ai"
    assert response.json()["matched_by"] is None


# =====================================================================
# AC5 — hits / last_hit_at for a served scripted hit
# =====================================================================


@pytest.mark.asyncio
async def test_a_scripted_hit_bumps_hits_and_stamps_last_hit_at(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC5: `QaService.record_hit` is the counter, so operators can see usage."""
    _forbid_provider(monkeypatch)
    qa_id = await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="keyword")
    await _exhaust_quota()

    before = await _pair_row(qa_id)
    assert before.hits == 0
    assert before.last_hit_at is None

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    assert _done(events)["mode"] == "scripted"

    after = await _pair_row(qa_id)
    assert after.hits == 1, "a served pair is counted once"
    assert after.last_hit_at is not None, "the operator can see when it last ran"


# =====================================================================
# AC6 — `off` and `llm` keep today's behaviour exactly
# =====================================================================


@pytest.mark.asyncio
async def test_fallback_mode_off_still_answers_429(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC6: the upgrade-safe default changes nothing, byte for byte."""
    _forbid_provider(monkeypatch)
    # A pair that WOULD match: proof the mode, not the data, decides.
    await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="off")
    await _exhaust_quota()

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )
    assert blocking.status_code == 429, blocking.text
    assert blocking.json()["detail"] == "Daily message quota exceeded"

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    error = dict(events).get("error")
    assert error is not None, events
    assert error["code"] == "QUOTA_EXCEEDED"
    assert [name for name, _ in events].count("done") == 0


@pytest.mark.asyncio
async def test_an_unset_column_reads_as_off(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC6: a row from before the migration must never enable the path.

    The column is NOT NULL, so the pre-migration shape is reproduced through the
    reader (a NULL/stale attribute), not by writing NULL into the table — the
    migration's own `UPDATE ... SET fallback_mode = 'off'` covers the table.
    """
    _forbid_provider(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="off")
    await _exhaust_quota()

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )
    assert blocking.status_code == 429, blocking.text

    # The reader normalises every shape the table can hold, plus the shapes an
    # in-memory row could still carry (NULL from a legacy SELECT, junk from a
    # hand-edited database).
    from api.v1.endpoints import fallback_mode

    class _Row:
        def __init__(self, value: Any) -> None:
            self.fallback_mode = value

    for junk in (None, "", "  ", "bogus", 7, ["keyword"]):
        assert fallback_mode(_Row(junk)) == "off", junk
    assert fallback_mode(_Row("keyword")) == "keyword"
    assert fallback_mode(_Row(" KEYWORD ")) == "keyword"
    assert fallback_mode(_Row("llm_then_keyword")) == "llm_then_keyword"
    # A row with no attribute at all (an older ORM shape) is `off` too.
    assert fallback_mode(object()) == "off"


@pytest.mark.asyncio
async def test_fallback_mode_llm_never_consults_the_keyword_matcher(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC6: `llm` is today's #44 path; the matcher is not even called."""
    calls = _install_provider(monkeypatch, _ScriptedProvider("LLM_ANSWER 来自模型。"))
    # `llm` runs the full semantic path before the provider is built.
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="llm")
    await _set_used_today(0)

    # Spy on the ONE helper every keyword site goes through.
    matcher_calls: list[Any] = []

    async def forbidden_matcher(*args: Any, **kwargs: Any) -> Any:
        matcher_calls.append(args)
        raise AssertionError("the keyword matcher ran under fallback_mode=llm")

    monkeypatch.setattr("api.v1.endpoints._scripted_answer", forbidden_matcher)

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert "LLM_ANSWER" in _content(events)
    assert done["mode"] == "ai"
    assert matcher_calls == [], matcher_calls
    assert calls and calls[0]["model"] == "deepseek-v4-flash", calls


@pytest.mark.asyncio
async def test_fallback_mode_llm_quota_miss_without_a_fallback_model_still_429s(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """AC6: `llm` with no `fallback_model` is exactly today's wall."""
    _forbid_provider(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="llm", fallback_model=None
    )
    await _exhaust_quota()

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )
    assert blocking.status_code == 429, blocking.text


# =====================================================================
# quota-miss is 200 for `keyword` and `llm_then_keyword` only
# =====================================================================


@pytest.mark.asyncio
async def test_llm_then_keyword_with_no_fallback_model_serves_the_pair(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """`llm_then_keyword` with nothing to degrade to falls through to the pair."""
    _install_provider(monkeypatch, _FailingProvider())
    qa_id = await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id,
        fallback_mode="llm_then_keyword",
        fallback_model=None,
    )
    await _exhaust_quota()

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert PAIR_ANSWER in _content(events), _content(events)
    assert done["mode"] == "scripted"
    assert done["matched_by"] == "keyword"
    assert (await _pair_row(qa_id)).hits == 1


@pytest.mark.asyncio
async def test_llm_then_keyword_with_a_fallback_model_answers_from_the_model(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """#44 wins when it can serve: the pair must NOT answer, and is not counted."""
    calls: list[Any] = []

    class _ModelAware:
        def __init__(self, model: Optional[str]) -> None:
            self._model = model

        async def chat_completion(self, **kwargs: Any) -> AsyncIterator[str]:
            yield "FALLBACK_MODEL_ANSWER 来自备用模型。"

        def get_last_usage(self) -> Optional[Dict[str, int]]:
            return None

    def factory(**kwargs: Any) -> Any:
        calls.append(kwargs.get("model"))
        return _ModelAware(kwargs.get("model"))

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", factory)
    qa_id = await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id,
        fallback_mode="llm_then_keyword",
        fallback_model="cheap-fallback-model",
        fallback_key="sk-fallback-scripted",
    )
    await _exhaust_quota()

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert "FALLBACK_MODEL_ANSWER" in _content(events), _content(events)
    assert PAIR_ANSWER not in _content(events)
    assert done["degraded"] is True, done
    assert done["model"] == "cheap-fallback-model", done
    assert done["mode"] == "ai", done
    assert calls == ["cheap-fallback-model"], calls
    assert (await _pair_row(qa_id)).hits == 0, "the pair never spoke"


@pytest.mark.asyncio
async def test_llm_then_keyword_falls_through_when_the_fallback_call_raises(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """The fallback model's own call failing falls through to the matcher."""
    _install_provider(monkeypatch, _FailingProvider())
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id,
        fallback_mode="llm_then_keyword",
        fallback_model="cheap-fallback-model",
        fallback_key="sk-fallback-scripted",
    )
    await _exhaust_quota()

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert PAIR_ANSWER in _content(events), _content(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] == "keyword", done


# =====================================================================
# invariant 3 — the keyless 400 is unchanged in EVERY mode
# =====================================================================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode", ["off", "llm", "keyword", "llm_then_keyword"]
)
async def test_a_keyless_agent_gets_the_same_400_in_every_mode(
    public_client, default_agent_id, bound_kb_id, monkeypatch, mode
):
    """Invariant #19: a scripted answer is never served to a keyless agent.

    The pair WOULD match and the allowance is spent, so every reason to serve a
    scripted turn is present — and the key gate must still win.
    """
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    agent_kb_id = str(uuid.uuid4())

    async with database.AsyncSessionLocal() as session:
        template = (
            await session.execute(select(Agent).order_by(Agent.created_at).limit(1))
        ).scalars().first()
        assert template is not None
        agent = Agent(
            workspace_id=template.workspace_id,
            name="Keyless Scripted Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            api_key=None,
            # `agents.kb_id` is UNIQUE, so this ad-hoc row gets its own KB —
            # `agent_kb_id`, the same id the matching pair is seeded on.
            kb_id=agent_kb_id,
            fallback_mode=mode,
            fallback_model="cheap-fallback-model",
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        keyless_agent_id = agent.id

    # Its own KB carries the matching pair, so the ONLY thing refusing the
    # scripted turn is the missing key.
    await _seed_pair(agent_kb_id)

    # (a) A turn that is inside the allowance reaches the key gate: 400 / SSE
    #     API_KEY_MISSING — the documented #19 invariant.
    await _set_used_today(0)

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": MATCHING_MESSAGE},
    )
    assert blocking.status_code == 400, blocking.text
    assert (
        blocking.json()["detail"] == "Agent has no LLM API key configured"
    ), blocking.json()

    events = await _stream(public_client, keyless_agent_id, MATCHING_MESSAGE)
    error = dict(events).get("error")
    assert error is not None, events
    assert error["code"] == "API_KEY_MISSING", events
    assert [name for name, _ in events].count("done") == 0

    # (b) With the allowance spent, the key gate still beats the scripted turn:
    #     `keyword` modes must NOT quietly serve the pair to a keyless agent.
    await _exhaust_quota()

    blocking_spent = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": MATCHING_MESSAGE},
    )
    if mode in ("off", "llm"):
        # Today's wall, unchanged for the modes that do not opt in.
        assert blocking_spent.status_code == 429, blocking_spent.text
    else:
        # The scripted resolution happened above the key gate, but the answer
        # is never served: the same 400, not a silent FAQ bot.
        assert blocking_spent.status_code == 400, blocking_spent.text
        assert (
            blocking_spent.json()["detail"]
            == "Agent has no LLM API key configured"
        ), blocking_spent.json()

    # Nothing embedded, and the pair was never counted as served.
    assert embed_calls == []
    pair = await session_pair(agent_kb_id)
    assert pair.hits == 0, "a 400 must not inflate the pair's hit counter"


# =====================================================================
# `fallback_mode` round-trips through GET / PUT
# =====================================================================


@pytest.mark.asyncio
async def test_fallback_mode_round_trips_through_the_agent_api(
    client, default_agent_id
):
    """The settings page can read and write the switch; `off` is the default."""
    agent_id = (await client.get("/api/v1/agent:default")).json()["id"]

    # A freshly created agent never opts in: `off` is the upgrade-safe default.
    assert (await client.get(f"/api/v1/agent?agent_id={agent_id}")).json()[
        "fallback_mode"
    ] in ("off", "llm", "keyword", "llm_then_keyword")

    for mode in ("llm", "keyword", "llm_then_keyword", "off"):
        response = await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json={"fallback_mode": mode},
        )
        assert response.status_code == 200, response.text
        assert response.json()["fallback_mode"] == mode, response.json()
        fetched = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        assert fetched.json()["fallback_mode"] == mode

    # A value outside the four is rejected by the schema, never silently stored.
    rejected = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"fallback_mode": "sometimes"},
    )
    assert rejected.status_code == 422, rejected.text


def test_the_agent_payload_defaults_to_off_without_the_column():
    """`build_agent_config` never returns a value the chat path cannot honour."""
    from api.v1.endpoints import build_agent_config
    from models import Agent

    # A detached row: SQLAlchemy applies the column default at INSERT, so
    # `fallback_mode` is genuinely unset here — the legacy/upgrade shape.
    payload = build_agent_config(Agent(name="Unit", model="m"))
    assert payload["fallback_mode"] == "off"

    # A junk value stored by hand also reads as `off`, never as itself.
    junk = Agent(name="Unit", model="m")
    junk.fallback_mode = "sometimes"
    assert build_agent_config(junk)["fallback_mode"] == "off"

    chosen = Agent(name="Unit", model="m")
    chosen.fallback_mode = "keyword"
    assert build_agent_config(chosen)["fallback_mode"] == "keyword"

# =====================================================================
# #60 follow-up — `matched_by` IS PERSISTED, so the transcript can tell a
# keyword HIT from a MISS (both are `mode="scripted"`; only a hit answered)
# =====================================================================

async def _admin_messages(client: Any, session_public_id: str) -> list[Dict[str, Any]]:
    """The operator-facing transcript rows for one session."""
    async with database.AsyncSessionLocal() as session:
        internal_id = await session.scalar(
            select(ChatSession.id).where(
                ChatSession.session_id == session_public_id
            )
        )
        assert internal_id is not None, session_public_id
    response = await client.get(f"/api/v1/admin/sessions/{internal_id}/messages")
    assert response.status_code == 200, response.text
    return response.json()

@pytest.mark.asyncio
async def test_a_keyword_hit_persists_matched_by_keyword(
    public_client, client, default_agent_id, bound_kb_id, monkeypatch
):
    """A hit stores `matched_by="keyword"` — the transcript's only honest proof.

    `mode="scripted"` alone cannot distinguish a served pair from the
    operator's apology, which is why the column exists.
    """
    _forbid_provider(monkeypatch)
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _exhaust_quota()

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] == "keyword", done

    rows = await _assistant_rows(done["session_id"])
    assert len(rows) == 1
    assert rows[0].content == PAIR_ANSWER
    assert rows[0].mode == "scripted"
    assert rows[0].matched_by == "keyword", (
        "a served pair must persist WHAT matched it, not just that it was scripted"
    )

    # And it reaches the admin transcript the operator actually reads.
    transcript = await _admin_messages(client, done["session_id"])
    assistant = [m for m in transcript if m["role"] == "assistant"]
    assert len(assistant) == 1, transcript
    assert assistant[0]["mode"] == "scripted"
    assert assistant[0]["matched_by"] == "keyword", assistant[0]

@pytest.mark.asyncio
async def test_a_scripted_miss_persists_matched_by_none(
    public_client, client, default_agent_id, bound_kb_id, monkeypatch
):
    """A miss keeps `mode="scripted"` but stores NULL — the text is an apology.

    This is the exact defect: the operator note `由常见问题自动回答` used to
    render on the apology too, because nothing on the row said nothing matched.
    """
    _forbid_provider(monkeypatch)
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _exhaust_quota()

    events = await _stream(public_client, default_agent_id, NON_MATCHING_MESSAGE)
    done = _done(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] is None, done

    rows = await _assistant_rows(done["session_id"])
    assert len(rows) == 1
    assert rows[0].content == OPERATOR_RESTRICTED
    assert rows[0].mode == "scripted", "a miss is still not a model answer"
    assert rows[0].matched_by is None, (
        "nothing matched, so the row must not claim a keyword did"
    )

    transcript = await _admin_messages(client, done["session_id"])
    assistant = [m for m in transcript if m["role"] == "assistant"]
    assert len(assistant) == 1, transcript
    assert assistant[0]["mode"] == "scripted"
    assert assistant[0]["matched_by"] is None, assistant[0]

@pytest.mark.asyncio
async def test_a_provider_failure_hit_persists_matched_by_keyword(
    public_client, client, default_agent_id, bound_kb_id, monkeypatch
):
    """The blocking `/chat` failure site persists the marker too (same seam)."""
    _install_provider(monkeypatch, _FailingProvider())
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(
        default_agent_id, fallback_mode="keyword", restricted_reply=OPERATOR_RESTRICTED
    )
    await _set_used_today(0)

    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "scripted", body
    assert body["matched_by"] == "keyword", body

    rows = await _assistant_rows(body["session_id"])
    assert len(rows) == 1
    assert rows[0].mode == "scripted"
    assert rows[0].matched_by == "keyword"

    transcript = await _admin_messages(client, body["session_id"])
    assistant = [m for m in transcript if m["role"] == "assistant"]
    assert assistant and assistant[0]["matched_by"] == "keyword", assistant

@pytest.mark.asyncio
async def test_an_ai_turn_persists_matched_by_none(
    public_client, client, default_agent_id, bound_kb_id, monkeypatch
):
    """An ordinary model answer is `ai` + NULL, so no `ai` row can claim a match."""
    _install_provider(monkeypatch, _ScriptedProvider("NORMAL_ANSWER 这是模型回答。"))
    _count_embeddings(monkeypatch)
    await _seed_pair(bound_kb_id)
    await _configure_agent(default_agent_id, fallback_mode="keyword")
    await _set_used_today(0)

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)
    assert done["mode"] == "ai", done
    assert done["matched_by"] is None, done

    rows = await _assistant_rows(done["session_id"])
    assert len(rows) == 1
    assert rows[0].mode == "ai"
    assert rows[0].matched_by is None

    transcript = await _admin_messages(client, done["session_id"])
    assistant = [m for m in transcript if m["role"] == "assistant"]
    assert assistant and assistant[0]["mode"] == "ai", assistant
    assert assistant[0]["matched_by"] is None, assistant
