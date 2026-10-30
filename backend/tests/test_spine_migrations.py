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
        "starters",
        "widget_cards",
        "traffic_percentage",
        "escalation_rules",
        "business_hours",
        "away_message",
        "ai_disclosure",
        "fixed_facts",
        "fallback_model",
        "fallback_api_key",
        "identity_secret",
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
    "chat_messages": ["confidence", "is_unanswered", "rating"],
}

NEW_TABLES = ["qa_items", "procedures", "leads", "webhooks"]


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
