"""Issue #66 — a keyless agent answers from the keyword path.

Restated once, because every assertion below hangs off it:

    A keyless agent (no `agent.api_key`) used to be a hard wall: `400` /
    `API_KEY_MISSING` in every mode, no matter what. #66 turns the key gate
    into a serve site:

    - keyless + `fallback_mode="keyword"`  -> the scripted path answers:
      a keyword hit serves the pair, a miss serves the operator's
      `restricted_reply` — a normal 200 turn either way;
    - keyless + `fallback_mode="off"`      -> today's wall stands: `400` on
      `/chat`, `API_KEY_MISSING` on the stream (opt-in, never a silent FAQ bot);
    - keyless + `preview: true` (authenticated admin only) -> the keyword path
      serves the turn regardless of `fallback_mode`: it is the operator
      testing in the Playground, not a visitor;
    - a keyed agent is unchanged in every mode.

    The scripted path makes ZERO provider calls: no `get_llm_service`, no
    `QaService.search`, no `KbRetrievalService.retrieve` (all three embed or
    call a provider — exactly what a keyless agent lacks).

The matrix is exercised on BOTH chat endpoints (`/chat` blocking and
`/chat/stream` SSE) so the two cannot drift.
"""

import json
import uuid
from typing import Any, AsyncIterator, Dict, Optional

import pytest
from sqlalchemy import select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession, QaItem

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

class _FailingProvider:
    """Every `chat_completion` raises: the provider is hard-down."""

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
    """Make building an LLM service a hard failure (the zero-call proof)."""

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
    restricted_reply: Optional[str] = None,
    primary_key: Optional[str] = "sk-scripted-test",
) -> None:
    """Set the switches this issue wires: the key and the mode."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key(primary_key) if primary_key else None
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

async def _keyless_agent(
    *,
    fallback_mode: str = "keyword",
    with_kb: bool = True,
    restricted_reply: Optional[str] = OPERATOR_RESTRICTED,
) -> str:
    """Create a fresh keyless agent (its own KB, since `agents.kb_id` is UNIQUE)."""
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
            kb_id=agent_kb_id if with_kb else None,
            fallback_mode=fallback_mode,
            restricted_reply=restricted_reply,
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        keyless_agent_id = agent.id
    if with_kb:
        await _seed_pair(agent_kb_id)
    return keyless_agent_id

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
# 1 — keyless + `keyword` mode: the scripted path serves the turn
# =====================================================================

@pytest.mark.asyncio
async def test_keyless_keyword_agent_serves_a_matching_pair_with_no_provider_call(
    public_client, default_agent_id, bound_kb_id, monkeypatch
):
    """Keyless + keyword + a matching message -> the pair's text, 200, no provider.

    The two monkeypatches are the proof, not decoration: `get_llm_service` raises
    on construction and `DocumentParser.embed_texts` records every call (both the
    `QaService.search` and `KbRetrievalService.retrieve` seams embed through it).
    A single call to either fails the test by name.
    """
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    keyless_agent_id = await _keyless_agent()

    # Blocking endpoint.
    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": MATCHING_MESSAGE},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reply"] == PAIR_ANSWER
    assert body["mode"] == "scripted", body
    assert body["matched_by"] == "keyword", body
    assert body["message_id"] is not None

    rows = await _assistant_rows(body["session_id"])
    assert len(rows) == 1
    assert rows[0].content == PAIR_ANSWER
    assert rows[0].mode == "scripted"
    assert rows[0].matched_by == "keyword"

    # Streaming endpoint: same serve site, same zero-provider guarantee, and
    # the same `sources` -> `content` -> `done` event order a model answer uses.
    events = await _stream(public_client, keyless_agent_id, MATCHING_MESSAGE)
    done = _done(events)
    assert [name for name, _ in events].count("error") == 0, events
    assert [name for name, _ in events] == ["sources", "content", "done"], events
    assert PAIR_ANSWER in _content(events), _content(events)
    assert OPERATOR_RESTRICTED not in _content(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] == "keyword", done
    # A scripted turn never counts as a model answer: no usage, no token spend.
    assert done["usage"] is None, done

    assert embed_calls == [], f"the semantic paths embedded: {embed_calls}"

@pytest.mark.asyncio
async def test_keyless_keyword_agent_serves_the_restricted_reply_on_a_miss(
    public_client, monkeypatch
):
    """A miss is NOT a wall: the operator's restricted reply, a normal 200 turn."""
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    keyless_agent_id = await _keyless_agent()

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": NON_MATCHING_MESSAGE},
    )
    assert blocking.status_code == 200, blocking.text
    body = blocking.json()
    assert body["reply"] == OPERATOR_RESTRICTED
    assert body["mode"] == "scripted"
    assert body["matched_by"] is None, "nothing matched, so no source to name"

    rows = await _assistant_rows(body["session_id"])
    assert len(rows) == 1, "exactly one assistant turn, no extra row"
    assert rows[0].content == OPERATOR_RESTRICTED
    assert rows[0].mode == "scripted"
    assert rows[0].matched_by is None

    events = await _stream(public_client, keyless_agent_id, NON_MATCHING_MESSAGE)
    done = _done(events)
    assert [name for name, _ in events].count("error") == 0, events
    assert OPERATOR_RESTRICTED in _content(events), _content(events)
    assert PAIR_ANSWER not in _content(events)
    assert done["mode"] == "scripted", done
    assert done["matched_by"] is None, done
    assert embed_calls == [], f"the semantic paths embedded: {embed_calls}"

@pytest.mark.asyncio
async def test_a_keyless_served_pair_is_counted_but_a_miss_is_not(
    public_client, monkeypatch
):
    """`record_scripted_hit` runs at the serve point — hit once, miss never."""
    _forbid_provider(monkeypatch)
    hit_agent = await _keyless_agent()
    kb_id_hit = (
        await session_pair((await _agent_kb(hit_agent)))
    ).kb_id
    hit_qa_id = (await session_pair(kb_id_hit)).id

    miss_agent = await _keyless_agent()
    miss_qa_id = (await session_pair(await _agent_kb(miss_agent))).id

    await public_client.post(
        "/api/v1/chat",
        json={"agent_id": hit_agent, "message": MATCHING_MESSAGE},
    )
    await public_client.post(
        "/api/v1/chat",
        json={"agent_id": miss_agent, "message": NON_MATCHING_MESSAGE},
    )

    assert (await _pair_row(hit_qa_id)).hits == 1, "a served pair is counted"
    assert (await _pair_row(hit_qa_id)).last_hit_at is not None
    assert (await _pair_row(miss_qa_id)).hits == 0, "a miss inflates nothing"

async def _agent_kb(agent_id: str) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent is not None and agent.kb_id
        return str(agent.kb_id)

# =====================================================================
# 2 — keyless + `off`: today's wall stands (400 / API_KEY_MISSING)
# =====================================================================

@pytest.mark.asyncio
async def test_keyless_off_agent_still_answers_400_and_api_key_missing(
    public_client, monkeypatch
):
    """Opt-in, never a silent FAQ bot: with `off` the keyless 400 remains."""
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    keyless_agent_id = await _keyless_agent(fallback_mode="off")

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

    # The miss-side too: `off` refuses both shapes of message.
    blocking_miss = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": NON_MATCHING_MESSAGE},
    )
    assert blocking_miss.status_code == 400, blocking_miss.text

    assert embed_calls == [], f"the semantic paths embedded: {embed_calls}"

@pytest.mark.asyncio
async def test_an_unset_fallback_mode_reads_as_off_for_a_keyless_agent(
    public_client, monkeypatch
):
    """A row from before the migration (or with a stale value) never opts in."""
    _forbid_provider(monkeypatch)
    keyless_agent_id = await _keyless_agent(fallback_mode="off")

    # The reader normalises every shape the table can hold, plus the shapes an
    # in-memory row could still carry (NULL from a legacy SELECT, junk from a
    # hand-edited database). #62 retired `llm` / `llm_then_keyword`: they read
    # as `off` now, because the #44 model they named is gone.
    from api.v1.endpoints import fallback_mode

    class _Row:
        def __init__(self, value: Any) -> None:
            self.fallback_mode = value

    for junk in (None, "", "  ", "bogus", 7, ["keyword"], "llm", "llm_then_keyword"):
        assert fallback_mode(_Row(junk)) == "off", junk
    assert fallback_mode(_Row("keyword")) == "keyword"
    assert fallback_mode(_Row(" KEYWORD ")) == "keyword"
    # A row with no attribute at all (an older ORM shape) is `off` too.
    assert fallback_mode(object()) == "off"

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": MATCHING_MESSAGE},
    )
    assert blocking.status_code == 400, blocking.text

# =====================================================================
# 3 — keyless + `preview: true`: the Playground turn, admin-gated
# =====================================================================

@pytest.mark.asyncio
async def test_keyless_preview_turn_serves_the_keyword_path_regardless_of_mode(
    public_client, client, default_agent_id, monkeypatch
):
    """An authenticated preview turn gets the scripted path even with `off`.

    The flag is a *request*, not a grant: without the admin bearer token the
    public endpoint ignores it and the 400 wall stands.
    """
    _forbid_provider(monkeypatch)
    embed_calls = _count_embeddings(monkeypatch)
    keyless_agent_id = await _keyless_agent(fallback_mode="off")

    # (a) No admin token: `preview: true` is ignored — the visitor's 400.
    anonymous = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": keyless_agent_id,
            "message": MATCHING_MESSAGE,
            "preview": True,
        },
    )
    assert anonymous.status_code == 400, anonymous.text

    # (b) With the admin token: the Playground turn is served by the keyword
    #     path, and the miss-side serves the restricted reply (200).
    token = await _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    served = await public_client.post(
        "/api/v1/chat",
        headers=headers,
        json={
            "agent_id": keyless_agent_id,
            "message": MATCHING_MESSAGE,
            "preview": True,
        },
    )
    assert served.status_code == 200, served.text
    body = served.json()
    assert body["reply"] == PAIR_ANSWER
    assert body["mode"] == "scripted", body
    assert body["matched_by"] == "keyword", body

    miss = await public_client.post(
        "/api/v1/chat",
        headers=headers,
        json={
            "agent_id": keyless_agent_id,
            "message": NON_MATCHING_MESSAGE,
            "preview": True,
        },
    )
    assert miss.status_code == 200, miss.text
    assert miss.json()["reply"] == OPERATOR_RESTRICTED
    assert miss.json()["mode"] == "scripted"

    assert embed_calls == [], f"the semantic paths embedded: {embed_calls}"

async def _admin_token(client: Any) -> str:
    from tests.conftest import ensure_test_admin_token

    return await ensure_test_admin_token()

# =====================================================================
# 4 — a keyed agent is unchanged in every mode
# =====================================================================

@pytest.mark.asyncio
async def test_a_keyed_agent_still_gets_its_model_answer(
    public_client, default_agent_id, monkeypatch
):
    """`api_key` present -> the model answers; the key gate never fires."""
    calls = _install_provider(
        monkeypatch, _ScriptedProvider("NORMAL_ANSWER 这是模型回答。")
    )
    _count_embeddings(monkeypatch)
    await _configure_agent(default_agent_id, fallback_mode="keyword")

    events = await _stream(public_client, default_agent_id, MATCHING_MESSAGE)
    done = _done(events)

    assert "NORMAL_ANSWER" in _content(events)
    assert done["mode"] == "ai", done
    assert done["matched_by"] is None, done
    assert calls, "the keyed agent must reach its provider"

@pytest.mark.asyncio
async def test_a_keyed_keyword_agent_still_prefers_its_model(
    public_client, default_agent_id, monkeypatch
):
    """The keyword path is a keyless serve site, not a keyed override.

    With a key configured, `fallback_mode="keyword"` changes nothing for a
    turn the provider can serve: the model still answers (`mode: "ai"`).
    """
    _install_provider(
        monkeypatch, _ScriptedProvider("KEYED_ANSWER 来自模型。")
    )
    _count_embeddings(monkeypatch)
    await _configure_agent(default_agent_id, fallback_mode="keyword")

    blocking = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": default_agent_id, "message": MATCHING_MESSAGE},
    )
    assert blocking.status_code == 200, blocking.text
    assert blocking.json()["mode"] == "ai", blocking.json()

# =====================================================================
# 5 — the 400 must not inflate the pair's hit counter, and `fallback_mode`
#     round-trips through GET / PUT
# =====================================================================

@pytest.mark.asyncio
async def test_a_keyless_400_inflates_no_hits(public_client, monkeypatch):
    """Even where the wall stands (`off`), nothing is counted as served."""
    _forbid_provider(monkeypatch)
    keyless_agent_id = await _keyless_agent(fallback_mode="off")
    qa_id = (await session_pair(await _agent_kb(keyless_agent_id))).id

    await public_client.post(
        "/api/v1/chat",
        json={"agent_id": keyless_agent_id, "message": MATCHING_MESSAGE},
    )
    assert (await _pair_row(qa_id)).hits == 0, "a 400 must not inflate the counter"

@pytest.mark.asyncio
async def test_fallback_mode_round_trips_through_the_agent_api(client, default_agent_id):
    """The settings page can read and write the switch; `off` is the default."""
    agent_id = (await client.get("/api/v1/agent:default")).json()["id"]

    # A freshly created agent never opts in: `off` is the upgrade-safe default.
    assert (await client.get(f"/api/v1/agent?agent_id={agent_id}")).json()[
        "fallback_mode"
    ] in ("off", "keyword")

    for mode in ("keyword", "off"):
        response = await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json={"fallback_mode": mode},
        )
        assert response.status_code == 200, response.text
        assert response.json()["fallback_mode"] == mode, response.json()
        fetched = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        assert fetched.json()["fallback_mode"] == mode

    # A value outside the two is rejected by the schema, never silently stored.
    rejected = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"fallback_mode": "sometimes"},
    )
    assert rejected.status_code == 422, rejected.text

    # The #62-retired values are schema-invalid too: the model they named is gone.
    for retired in ("llm", "llm_then_keyword"):
        retired_response = await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json={"fallback_mode": retired},
        )
        assert retired_response.status_code == 422, retired_response.text

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
# 6 — `matched_by` IS PERSISTED, so the transcript can tell a keyword HIT
#     from a MISS (both are `mode="scripted"`; only a hit answered)
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
async def test_a_keyless_keyword_hit_persists_matched_by_keyword(
    public_client, client, monkeypatch
):
    """A hit stores `matched_by="keyword"` — the transcript's only honest proof.

    `mode="scripted"` alone cannot distinguish a served pair from the
    operator's apology, which is why the column exists.
    """
    _forbid_provider(monkeypatch)
    _count_embeddings(monkeypatch)
    keyless_agent_id = await _keyless_agent()

    events = await _stream(public_client, keyless_agent_id, MATCHING_MESSAGE)
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
async def test_a_keyless_keyword_miss_persists_matched_by_none(
    public_client, client, monkeypatch
):
    """A miss keeps `mode="scripted"` but stores NULL — the text is an apology."""
    _forbid_provider(monkeypatch)
    _count_embeddings(monkeypatch)
    keyless_agent_id = await _keyless_agent()

    events = await _stream(public_client, keyless_agent_id, NON_MATCHING_MESSAGE)
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
async def test_an_ai_turn_persists_matched_by_none(
    public_client, client, default_agent_id, monkeypatch
):
    """An ordinary model answer is `ai` + NULL, so no `ai` row can claim a match."""
    _install_provider(monkeypatch, _ScriptedProvider("NORMAL_ANSWER 这是模型回答。"))
    _count_embeddings(monkeypatch)
    await _configure_agent(default_agent_id, fallback_mode="keyword")

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
