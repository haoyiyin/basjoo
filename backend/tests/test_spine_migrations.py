"""Spine migration: an existing database gains every new column and table
idempotently, and an old row keeps working.

Real upgrade path simulated honestly: build the *current* full schema with
``create_all``, drop the columns/table-list added by this change (SQLite
``DROP COLUMN``), then run the migration and assert it restored them. The
suite's own ``init_db()`` only ever covers the fresh-install path.
"""

import sqlite3

import pytest
from sqlalchemy import create_engine, text

import models  # noqa: F401  (registers every table on Base.metadata)
from database import Base
from models import Agent, ChatMessage, ChatSession, KnowledgeBase
from sqlite_migrations import run_sqlite_migrations

# Columns this change adds, per table. Keep in sync with models.py.
NEW_COLUMNS = {
    "agents": [
        "excluded_paths",
        "display_mode",
        "inline_container",
        "starters",
        "widget_cards",
        "traffic_percentage",
        "business_hours",
        "away_message",
        "ai_disclosure",
        "prechat_mode",
        "fixed_facts",
        "identity_secret",
        # #47: outbound webhook endpoint + encrypted signing secret.
        "webhook_url",
        "webhook_secret",
    ],
    "chat_sessions": [
        "mode",
        "human_replied_at",
        "contact_email",
        "contact_name",
        "transcript_sent_at",
        "active_procedure_id",
        "procedure_step",
        "topic",
        "sentiment",
        "outcome",
        "ai_turn_count",
    ],
    # #60: `mode` distinguishes a model answer from a keyword-matched one.
    # (#62: `degraded` was dropped — the flag existed only for the retired
    # #44 fallback model.)
    "chat_messages": [
        "confidence",
        "is_unanswered",
        "rating",
        "mode",
        "matched_by",
    ],
    # #47: the diffed-refetch key and the two-phase upload queue stage.
    "kb_documents": ["item_hash", "processing_stage"],
}

# Columns this change RETIRES. The migration must drop them from a database
# that still carries them, and they must never come back (#62 / #64).
RETIRED_COLUMNS = {
    "agents": ["escalation_rules", "fallback_model", "fallback_api_key"],
    "chat_messages": ["degraded"],
    "workspace_quotas": [
        "max_messages_per_day",
        "used_messages_today",
        "last_message_reset",
    ],
}

NEW_TABLES = ["qa_items", "procedures", "leads", "webhooks", "webhook_deliveries"]


def _columns(db_path: str, table: str) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    finally:
        conn.close()


def _seed_and_strip(db_path: str) -> None:
    """Create the full schema, add legacy rows, then remove the new shape."""
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO workspaces (id, name, owner_email) "
                "VALUES (1, 'Default', 'a@b.c')"
            )
        )
        # ORM insert so every NOT NULL default (system_prompt, model,
        # embedding_provider, …) is filled by the model, not by this test.
        for agent_id, name, colour in (
            ("agent-1", "Old Agent", "#06B6D4"),
            ("agent-2", "Branded Agent", "#123456"),
        ):
            conn.execute(
                Agent.__table__.insert().values(
                    id=agent_id,
                    workspace_id=1,
                    name=name,
                    widget_color=colour,
                    is_active=True,
                )
            )
        conn.execute(
            ChatSession.__table__.insert().values(
                id="sess_old",
                agent_id="agent-1",
                session_id="sess_agent-1_dead",
                status="active",
            )
        )
        conn.execute(
            ChatMessage.__table__.insert().values(
                session_id="sess_old", role="user", content="hello"
            )
        )
        conn.execute(
            KnowledgeBase.__table__.insert().values(
                id="kb-1",
                workspace_id=1,
                name="KB",
                qdrant_collection="kb_deadbeef0000",
            )
        )
    engine.dispose()

    conn = sqlite3.connect(db_path)
    try:
        for table in NEW_TABLES:
            conn.execute(f"DROP TABLE {table}")
        for table, cols in NEW_COLUMNS.items():
            for col in cols:
                conn.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
        # Recreate the RETIRED columns so the fixture reproduces a database
        # from before #62/#64: the migration must drop them (and keep every
        # other column).
        for table, cols in RETIRED_COLUMNS.items():
            for col in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def upgraded(tmp_path):
    db_path = str(tmp_path / "legacy.db")
    _seed_and_strip(db_path)
    # Precondition: the fixture really is the pre-change schema.
    assert "fixed_facts" not in _columns(db_path, "agents")
    assert "mode" not in _columns(db_path, "chat_sessions")
    run_sqlite_migrations(f"sqlite:///{db_path}")
    return db_path


def test_new_columns_restored(upgraded):
    for table, cols in NEW_COLUMNS.items():
        actual = _columns(upgraded, table)
        missing = [c for c in cols if c not in actual]
        assert not missing, f"{table} missing after migration: {missing}"

def test_retired_columns_dropped_and_never_back(upgraded):
    """#62 / #64: the daily-message, fallback-model and escalation columns
    are dropped by the migration and never re-added, while every other
    column on those tables survives."""
    for table, cols in RETIRED_COLUMNS.items():
        actual = _columns(upgraded, table)
        present = [c for c in cols if c in actual]
        assert not present, f"{table} still carries retired columns: {present}"
    # The other four limits survive on workspace_quotas.
    quota_columns = _columns(upgraded, "workspace_quotas")
    for col in (
        "max_agents",
        "max_urls",
        "max_qa_items",
        "max_total_text_mb",
        "used_urls",
        "used_qa_items",
        "used_total_text_mb",
    ):
        assert col in quota_columns, f"workspace_quotas lost {col}"
    # The rest of chat_messages survives too.
    message_columns = _columns(upgraded, "chat_messages")
    for col in ("confidence", "is_unanswered", "rating", "mode", "matched_by"):
        assert col in message_columns, f"chat_messages lost {col}"


def test_new_tables_created_empty(upgraded):
    conn = sqlite3.connect(upgraded)
    try:
        for table in NEW_TABLES:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            assert count == 0, f"{table} should be created empty"
    finally:
        conn.close()


def test_old_rows_keep_working(upgraded):
    """The upgrade must not lose or reinterpret an existing row."""
    conn = sqlite3.connect(upgraded)
    try:
        name, colour = conn.execute(
            "SELECT name, widget_color FROM agents WHERE id = 'agent-1'"
        ).fetchone()
        assert name == "Old Agent"
        # The old default was never an operator choice -> one accent.
        assert colour == "#F9CA02"

        branded = conn.execute(
            "SELECT widget_color FROM agents WHERE id = 'agent-2'"
        ).fetchone()
        # A colour the operator actually picked is untouched.
        assert branded[0] == "#123456"

        mode, turns = conn.execute(
            "SELECT mode, ai_turn_count FROM chat_sessions WHERE id = 'sess_old'"
        ).fetchone()
        assert mode == "ai"
        assert turns == 0

        row = conn.execute(
            "SELECT is_unanswered, confidence, rating FROM chat_messages LIMIT 1"
        ).fetchone()
        assert row == (0, None, None)
    finally:
        conn.close()


def test_migration_is_idempotent(tmp_path):
    db_path = str(tmp_path / "legacy.db")
    _seed_and_strip(db_path)
    url = f"sqlite:///{db_path}"
    run_sqlite_migrations(url)
    first = {t: _columns(db_path, t) for t in NEW_COLUMNS}
    # Second run must not raise (duplicate column / table) and must not change
    # the shape.
    run_sqlite_migrations(url)
    assert {t: _columns(db_path, t) for t in NEW_COLUMNS} == first


def test_fresh_database_is_untouched(tmp_path):
    """No file yet -> no-op; create_all owns the schema."""
    missing = str(tmp_path / "nope.db")
    run_sqlite_migrations(f"sqlite:///{missing}")
    assert not (tmp_path / "nope.db").exists()
