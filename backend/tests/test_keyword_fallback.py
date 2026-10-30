"""Issue #60 — the LLM-free keyword matcher: normalisation, matching, ordering.

Every assertion here is on the artifact the chat path will consume: the
`KeywordHit` `match()` returns, the row `match_for_kb()` selects, or the column
shape `models.py` declares. The matcher is pure stdlib, so these tests run with
no provider, no Qdrant and no embeddings anywhere in reach.
"""

import contextlib
import sqlite3

import pytest
from sqlalchemy import create_engine, event, text

import database
import models  # noqa: F401  (registers every table on Base.metadata)
from database import Base
from models import Agent, QaItem
from services.keyword_fallback import (
    MIN_KEYWORD_LENGTH,
    KeywordHit,
    keyword_mode_enabled,
    match,
    match_for_kb,
    normalize,
)
from sqlite_migrations import run_sqlite_migrations

# --------------------------------------------------------------- normalisation

def test_normalize_folds_fullwidth_punctuation_and_letters():
    """An IME produces `，？！` and `Ａ`; both sides must meet in the middle."""
    assert normalize("Ａ，Ｂ？！") == "a b"
    assert normalize("　ｈｅｌｌｏ　") == "hello"

def test_normalize_lowercases():
    assert normalize("Return POLICY") == "return policy"

def test_normalize_turns_punctuation_into_a_separator():
    assert normalize("refund-window/30 days!") == "refund window 30 days"

def test_normalize_collapses_whitespace_and_strips():
    assert normalize("  a \t\n  b   c  ") == "a b c"

def test_normalize_empty_input():
    assert normalize("") == ""
    assert normalize("   ") == ""
    assert normalize("，？！") == ""

def test_normalize_keeps_underscore_and_digits():
    assert normalize("order_id 123") == "order_id 123"

# ------------------------------------------------------------ substring ≥2 rule

def test_chinese_keyword_matches_as_substring():
    """`退款` is 2 characters, so it matches inside an unsegmented sentence."""
    hit = match(
        [{"id": "q1", "question": "退款?", "answer": "30 天", "keywords": ["退款"],
          "hits": 0, "enabled": True}],
        "我要退款",
    )
    assert hit is not None
    assert hit.qa_id == "q1"
    assert hit.matched == ["退款"]

def test_single_char_keyword_never_matches():
    """`款` is 1 character: rejected at write time, and inert here as well.

    A row that predates write-time validation (or a hand-edited database) must
    not turn the matcher into "match everything containing this letter".
    """
    hit = match(
        [{"id": "q1", "question": "退款?", "answer": "30 天", "keywords": ["款"],
          "hits": 0, "enabled": True}],
        "我要退款",
    )
    assert hit is None

def test_min_keyword_length_is_two():
    assert MIN_KEYWORD_LENGTH == 2

def test_token_boundary_is_documented_and_pinned():
    """Documented behaviour, pinned: `ai` DOES match inside `said`.

    The rule allows a contiguous substring of ≥2 characters, so a two-letter
    keyword has no word-boundary protection. This is the interpretation the
    spec states; the test exists so a future change to it is a deliberate edit.
    """
    item = {"id": "q1", "question": "AI?", "answer": "yes", "keywords": ["ai"],
            "hits": 0, "enabled": True}
    hit = match([item], "he said nothing")
    assert hit is not None
    assert hit.matched == ["ai"]

def test_whole_token_match_also_works():
    item = {"id": "q1", "question": "AI?", "answer": "yes", "keywords": ["ai"],
            "hits": 0, "enabled": True}
    hit = match([item], "AI 客服在吗")
    assert hit is not None
    assert hit.matched == ["ai"]

def test_keyword_not_present_does_not_match():
    item = {"id": "q1", "question": "退款?", "answer": "30 天", "keywords": ["退款"],
            "hits": 0, "enabled": True}
    assert match([item], "你们几点营业") is None

def test_no_items_is_a_miss():
    assert match([], "退款") is None

def test_blank_message_is_a_miss():
    item = {"id": "q1", "question": "退款?", "answer": "30 天", "keywords": ["退款"],
            "hits": 0, "enabled": True}
    assert match([item], "   ，！ ") is None

# --------------------------------------------------------------- score & order

def test_score_is_one_point_per_matched_keyword():
    item = {"id": "q1", "question": "q", "answer": "a",
            "keywords": ["退款", "退货", "换货"], "hits": 0, "enabled": True}
    hit = match([item], "退款和退货怎么办")
    assert hit is not None
    assert hit.score == pytest.approx(2.0)
    assert hit.matched == ["退款", "退货"]

def test_score_is_a_float():
    item = {"id": "q1", "question": "q", "answer": "a", "keywords": ["退款"],
            "hits": 0, "enabled": True}
    hit = match([item], "退款")
    assert isinstance(hit.score, float)

def test_tie_break_prefers_higher_hits():
    """Equal score: the pair that has already answered more often wins."""
    low = {"id": "qa_low", "question": "low", "answer": "L",
           "keywords": ["退款"], "hits": 1, "enabled": True}
    high = {"id": "qa_high", "question": "high", "answer": "H",
            "keywords": ["退款"], "hits": 9, "enabled": True}
    # Deliberately the losing row first: iteration order must not decide.
    hit = match([low, high], "退款")
    assert hit is not None
    assert hit.qa_id == "qa_high", "higher `hits` must win an equal-score tie"

def test_tie_break_prefers_lower_id_when_hits_tie():
    """Equal score and equal hits: the lower `id` wins, so the answer is stable."""
    first = {"id": "qa_a", "question": "a", "answer": "A",
             "keywords": ["退款"], "hits": 2, "enabled": True}
    second = {"id": "qa_b", "question": "b", "answer": "B",
              "keywords": ["退款"], "hits": 2, "enabled": True}
    # Losing row first again.
    hit = match([second, first], "退款")
    assert hit is not None
    assert hit.qa_id == "qa_a", "lower `id` must win a fully-tied match"

def test_higher_score_beats_higher_hits():
    """Score dominates: a 2-keyword hit outranks a 1-keyword hit with more hits."""
    one = {"id": "qa_one", "question": "one", "answer": "1",
           "keywords": ["退款"], "hits": 50, "enabled": True}
    two = {"id": "qa_two", "question": "two", "answer": "2",
           "keywords": ["退款", "退货"], "hits": 0, "enabled": True}
    hit = match([one, two], "退款和退货")
    assert hit is not None
    assert hit.qa_id == "qa_two"

def test_order_is_deterministic_across_calls():
    items = [
        {"id": f"qa_{i:02d}", "question": "q", "answer": "a",
         "keywords": ["退款"], "hits": 3, "enabled": True}
        for i in range(20)
    ]
    ids = {match(items, "我想退款").qa_id for _ in range(10)}
    assert ids == {"qa_00"}

# ------------------------------------------------------------- exclusion rules

def test_disabled_pair_is_never_matched():
    """`enabled=False` is invisible to the keyword path, even as the only row."""
    disabled = {"id": "qa_off", "question": "q", "answer": "a",
                "keywords": ["退款"], "hits": 99, "enabled": False}
    assert match([disabled], "我要退款") is None

def test_disabled_pair_does_not_shadow_an_enabled_one():
    disabled = {"id": "qa_aaa", "question": "off", "answer": "OFF",
                "keywords": ["退款", "退货"], "hits": 99, "enabled": False}
    enabled = {"id": "qa_zzz", "question": "on", "answer": "ON",
               "keywords": ["退款"], "hits": 0, "enabled": True}
    hit = match([disabled, enabled], "退款和退货")
    assert hit is not None
    assert hit.qa_id == "qa_zzz"

def test_pair_with_empty_keywords_is_never_matched():
    item = {"id": "qa_empty", "question": "q", "answer": "a",
            "keywords": [], "hits": 0, "enabled": True}
    assert match([item], "我要退款") is None

def test_pair_with_null_keywords_is_never_matched():
    item = {"id": "qa_none", "question": "q", "answer": "a",
            "keywords": None, "hits": 0, "enabled": True}
    assert match([item], "我要退款") is None

def test_keyword_is_normalised_on_the_pair_side_too():
    """An operator may store `Ｒｅｔｕｒｎ` / `Return`; both fold to `return`."""
    item = {"id": "qa_ret", "question": "q", "answer": "30 days",
            "keywords": ["Ｒｅｔｕｒｎ"], "hits": 0, "enabled": True}
    hit = match([item], "Return policy?")
    assert hit is not None
    assert hit.matched == ["return"]

# ---------------------------------------------------------- keyword_mode_enabled

@pytest.mark.parametrize("mode", ["keyword", "llm_then_keyword", "KEYWORD"])
async def test_keyword_mode_enabled_for_keyword_modes(mode):
    assert await keyword_mode_enabled({"fallback_mode": mode}) is True

@pytest.mark.parametrize("mode", ["off", "llm", "", "bogus", None])
async def test_keyword_mode_disabled_for_other_modes(mode):
    assert await keyword_mode_enabled({"fallback_mode": mode}) is False

async def test_keyword_mode_disabled_for_missing_column():
    """A pre-#60 agent object without the attribute reads as `off`."""
    class LegacyAgent:
        pass

    assert await keyword_mode_enabled(LegacyAgent()) is False

async def test_keyword_mode_disabled_for_none_agent():
    assert await keyword_mode_enabled(None) is False

# ------------------------------------------------------------------ KeywordHit

def test_keyword_hit_is_frozen():
    hit = KeywordHit(qa_id="q", question="q?", answer="a", score=1.0, matched=["k"])
    with pytest.raises(Exception):
        hit.qa_id = "other"  # type: ignore[misc]

# ------------------------------------------------------------- match_for_kb (DB)

async def _seed_pair(kb_id, question, answer, keywords, enabled=True, hits=0):
    async with database.AsyncSessionLocal() as session:
        item = QaItem(
            kb_id=kb_id,
            question=question,
            answer=answer,
            keywords=keywords,
            enabled=enabled,
            hits=hits,
        )
        session.add(item)
        await session.commit()
        return item.id

@contextlib.contextmanager
def _recording_selects(engine):
    """Yield the list of SELECTs issued while the block runs."""
    statements: list[str] = []

    def _before(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    target = engine.sync_engine
    event.listen(target, "before_cursor_execute", _before)
    try:
        yield statements
    finally:
        event.remove(target, "before_cursor_execute", _before)

async def test_match_for_kb_returns_the_pair_with_one_query(bound_kb_id):
    await _seed_pair(bound_kb_id, "退款怎么处理？", "收货后 30 天内可退。", ["退款", "退货"])
    await _seed_pair(bound_kb_id, "几点营业？", "10:00-22:00。", ["营业"])

    with _recording_selects(database.engine) as selects:
        async with database.AsyncSessionLocal() as session:
            hit = await match_for_kb(session, bound_kb_id, "我要退款")

    assert hit is not None
    assert hit.answer == "收货后 30 天内可退。"
    assert hit.matched == ["退款"]
    assert len(selects) == 1, f"match_for_kb must issue one SELECT, got {len(selects)}"
    assert "qa_items" in selects[0]

async def test_match_for_kb_ignores_disabled_rows(bound_kb_id):
    await _seed_pair(
        bound_kb_id, "退款怎么处理？", "不该出现", ["退款"], enabled=False
    )
    async with database.AsyncSessionLocal() as session:
        hit = await match_for_kb(session, bound_kb_id, "我要退款")
    assert hit is None

async def test_match_for_kb_ignores_rows_without_keywords(bound_kb_id):
    await _seed_pair(bound_kb_id, "退款怎么处理？", "不该出现", [])
    async with database.AsyncSessionLocal() as session:
        hit = await match_for_kb(session, bound_kb_id, "我要退款")
    assert hit is None

async def test_match_for_kb_unknown_kb_is_a_miss(unbound_kb_id):
    async with database.AsyncSessionLocal() as session:
        hit = await match_for_kb(session, "kb_does_not_exist_at_all", "我要退款")
    assert hit is None

async def test_match_for_kb_empty_kb_is_a_miss(unbound_kb_id):
    """A real KB with no pairs at all must not raise."""
    async with database.AsyncSessionLocal() as session:
        hit = await match_for_kb(session, unbound_kb_id, "我要退款")
    assert hit is None

async def test_match_for_kb_scopes_to_the_kb(bound_kb_id, unbound_kb_id):
    """A pair in another KB is invisible."""
    await _seed_pair(unbound_kb_id, "退款怎么处理？", "别的 KB", ["退款"])
    async with database.AsyncSessionLocal() as session:
        hit = await match_for_kb(session, bound_kb_id, "我要退款")
    assert hit is None

async def test_match_for_kb_empty_kb_id_is_a_miss():
    async with database.AsyncSessionLocal() as session:
        assert await match_for_kb(session, "", "我要退款") is None

# ------------------------------------------------------- model column contract

def test_agent_fallback_mode_column_shape():
    column = Agent.__table__.columns["fallback_mode"]
    assert column.nullable is False
    assert column.type.length == 20
    assert column.default is not None
    assert column.default.arg == "off"

def test_qa_item_keywords_column_shape():
    column = QaItem.__table__.columns["keywords"]
    assert column.nullable is True
    assert column.default is None
    # JSON, not Text: the ORM round-trips the list without a json.loads here.
    assert type(column.type).__name__ == "JSON"

async def test_agent_default_is_off_without_an_explicit_value(setup_test_db):
    """An upgrade that sets nothing gets `off` — the byte-for-byte default.

    Asserted against the row, not the Python instance: `Column(default=...)` is
    an INSERT-time default, so a freshly constructed object still reads None
    until it is flushed. What matters is what the database ends up holding.
    """
    async with database.AsyncSessionLocal() as session:
        agent = Agent(
            id="agent_default_mode",
            workspace_id=1,
            name="Default mode",
            system_prompt="x",
            model="gpt-4o-mini",
            is_active=True,
        )
        session.add(agent)
        await session.commit()

        row = await session.scalar(
            text("SELECT fallback_mode FROM agents WHERE id = 'agent_default_mode'")
        )
    assert row == "off"


def test_keywords_defaults_to_none():
    """No keywords == never served by the keyword path, not `[]` surprises."""
    item = QaItem(kb_id="kb", question="q", answer="a")
    assert item.keywords is None

# ------------------------------------------------------- migration (idempotent)

_LEGACY_COLUMNS_TO_DROP = {
    "agents": ["fallback_mode"],
    "qa_items": ["keywords"],
}

def _columns(db_path: str, table: str) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    finally:
        conn.close()

def test_migration_restores_both_new_columns_idempotently(tmp_path):
    """The real upgrade path: current schema → drop the two columns → migrate.

    Run twice because startup runs it twice (``init_db`` and the entrypoint) and
    a second `ALTER TABLE ADD COLUMN` must not raise.
    """
    db_path = str(tmp_path / "legacy.db")
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO workspaces (id, name, owner_email) "
                "VALUES (1, 'W', 'w@example.com')"
            )
        )
        # Core inserts off the model tables, not raw text: every NOT NULL
        # column default (temperature, embedding_provider, …) is then filled by
        # the model itself rather than by this test.
        conn.execute(
            models.KnowledgeBase.__table__.insert().values(
                id="kb-1", workspace_id=1, name="KB", qdrant_collection="kb_deadbeef0000"
            )
        )
        conn.execute(
            Agent.__table__.insert().values(
                id="agent-1", workspace_id=1, name="Old", is_active=True
            )
        )
        conn.execute(
            QaItem.__table__.insert().values(
                id="qa-1", kb_id="kb-1", question="q", answer="a"
            )
        )
    engine.dispose()

    conn = sqlite3.connect(db_path)
    try:
        for table, cols in _LEGACY_COLUMNS_TO_DROP.items():
            for col in cols:
                conn.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
        conn.commit()
    finally:
        conn.close()

    # Precondition: this really is the pre-#60 shape.
    assert "fallback_mode" not in _columns(db_path, "agents")
    assert "keywords" not in _columns(db_path, "qa_items")

    url = f"sqlite:///{db_path}"
    run_sqlite_migrations(url)
    after_first = {t: _columns(db_path, t) for t in _LEGACY_COLUMNS_TO_DROP}
    run_sqlite_migrations(url)  # idempotent
    after_second = {t: _columns(db_path, t) for t in _LEGACY_COLUMNS_TO_DROP}

    assert "fallback_mode" in after_first["agents"]
    assert "keywords" in after_first["qa_items"]
    assert after_second == after_first

    conn = sqlite3.connect(db_path)
    try:
        # An existing agent keeps today's behaviour, and the pair keeps working.
        assert conn.execute(
            "SELECT fallback_mode FROM agents WHERE id = 'agent-1'"
        ).fetchone() == ("off",)
        assert conn.execute(
            "SELECT keywords, answer FROM qa_items WHERE id = 'qa-1'"
        ).fetchone() == (None, "a")
    finally:
        conn.close()

# A pre-#60 `agents` table: the column exists but is nullable and carries no
# default, which is what a hand-edited or half-migrated database looks like.
_LEGACY_AGENTS_WITH_NULLABLE_MODE = """
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'AI Agent',
    system_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant.',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 2000,
    api_key TEXT,
    api_base TEXT DEFAULT 'https://api.openai.com/v1',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    fallback_mode VARCHAR(20)
);
"""

def test_migration_normalises_a_null_fallback_mode(tmp_path):
    """A row whose `fallback_mode` is NULL must not stay NULL after startup.

    SQLite's ``ALTER TABLE ... ADD COLUMN ... DEFAULT 'off'`` backfills existing
    rows, but a column added without a default — or a raw INSERT that passed
    NULL — leaves NULL behind. The UPDATE beside the other normalisers is what
    guarantees the column is always readable as one of the four modes.
    """
    db_path = str(tmp_path / "half.db")
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(_LEGACY_AGENTS_WITH_NULLABLE_MODE)
        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, model, fallback_mode) "
            "VALUES ('agent-x', 1, 'X', 'm', NULL)"
        )
        conn.commit()
        assert conn.execute(
            "SELECT fallback_mode FROM agents WHERE id = 'agent-x'"
        ).fetchone() == (None,)
    finally:
        conn.close()

    run_sqlite_migrations(f"sqlite:///{db_path}")

    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute(
            "SELECT fallback_mode FROM agents WHERE id = 'agent-x'"
        ).fetchone() == ("off",)
    finally:
        conn.close()
