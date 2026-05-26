"""Tests for the shared SQLite migration module."""

import os
import sqlite3
import tempfile

import pytest

from sqlite_migrations import run_sqlite_migrations, _sqlite_db_path


# ---- URL parsing ------------------------------------------------------------


def test_sqlite_db_path_simple():
    path = _sqlite_db_path("sqlite:///app/data/basjoo.db")
    assert path is not None
    assert path.endswith("data/basjoo.db") or path.endswith("app/data/basjoo.db")


def test_sqlite_db_path_absolute():
    path = _sqlite_db_path("sqlite:////absolute/path/db.sqlite3")
    assert path == "/absolute/path/db.sqlite3"


def test_sqlite_db_path_aiosqlite():
    path = _sqlite_db_path("sqlite+aiosqlite:///relative/test.db")
    assert path is not None
    assert "test.db" in path


def test_sqlite_db_path_non_sqlite():
    assert _sqlite_db_path("postgresql://localhost/db") is None
    assert _sqlite_db_path("") is None


# ---- migration --------------------------------------------------------------


OLD_AGENTS_DDL = """
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'AI Agent',
    description TEXT,
    system_prompt TEXT NOT NULL DEFAULT 'You are a helpful customer service assistant.',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 2000,
    api_key TEXT,
    api_base TEXT DEFAULT 'https://api.openai.com/v1',
    jina_api_key TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
);
"""


def _create_old_db(db_path: str) -> str:
    """Create a minimal old-schema SQLite database and return its path."""
    conn = sqlite3.connect(db_path)
    conn.executescript(OLD_AGENTS_DDL)
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name, model, api_base) "
        "VALUES ('agt_old', 1, 'OldAgent', 'gpt-4o-mini', 'https://api.openai.com/v1')"
    )
    conn.commit()
    conn.close()
    return db_path


def _get_agent_columns(db_path: str) -> set:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(agents)")
    cols = {row[1] for row in cursor.fetchall()}
    conn.close()
    return cols


def test_migration_idempotent():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)

        # First run
        run_sqlite_migrations(f"sqlite:///{db_path}")
        cols_after_first = _get_agent_columns(db_path)

        # Second run should be a no-op (idempotent)
        run_sqlite_migrations(f"sqlite:///{db_path}")
        cols_after_second = _get_agent_columns(db_path)

        assert cols_after_first == cols_after_second
    finally:
        os.unlink(db_path)


def test_migration_adds_missing_provider_columns():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        cols = _get_agent_columns(db_path)

        assert "provider_type" in cols
        assert "azure_endpoint" in cols
        assert "azure_deployment_name" in cols
        assert "azure_api_version" in cols
        assert "anthropic_version" in cols
        assert "google_project_id" in cols
        assert "google_region" in cols
        assert "provider_config" in cols
    finally:
        os.unlink(db_path)


def test_migration_adds_missing_embedding_columns():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        cols = _get_agent_columns(db_path)

        assert "siliconflow_api_key" in cols
        assert "embedding_provider" in cols
        assert "embedding_api_base" in cols
        assert "embedding_model" in cols
        assert "embedding_batch_size" in cols
    finally:
        os.unlink(db_path)


def test_migration_adds_missing_crawl_retrieval_columns():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        cols = _get_agent_columns(db_path)

        assert "crawl_max_depth" in cols
        assert "crawl_max_pages" in cols
        assert "url_fetch_interval_days" in cols
        assert "enable_auto_fetch" in cols
        assert "top_k" in cols
        assert "similarity_threshold" in cols
        assert "enable_context" in cols
    finally:
        os.unlink(db_path)


def test_migration_adds_missing_widget_columns():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        cols = _get_agent_columns(db_path)

        assert "rate_limit_per_minute" in cols
        assert "restricted_reply" in cols
        assert "last_error_code" in cols
        assert "last_error_message" in cols
        assert "last_error_at" in cols
        assert "allowed_widget_origins" in cols
        assert "persona_type" in cols
        assert "widget_title" in cols
        assert "widget_color" in cols
        assert "welcome_message" in cols
        assert "history_days" in cols
    finally:
        os.unlink(db_path)


def test_migration_backfills_defaults():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM agents WHERE id = 'agt_old'").fetchone()
        conn.close()

        assert row["embedding_provider"] == "jina"
        assert row["embedding_model"] == "jina-embeddings-v3"
        assert row["provider_type"] == "openai"  # inferred from api_base https://api.openai.com/v1
        assert row["top_k"] == 5
        assert float(row["similarity_threshold"]) == pytest.approx(0.01)
        assert row["enable_context"] == 0
        assert row["history_days"] == 30
        assert row["rate_limit_per_minute"] == 20
        assert row["persona_type"] == "general"
        assert row["widget_title"] == "AI 客服"
        assert row["widget_color"] == "#06B6D4"
        assert "Basjoo" in row["welcome_message"] or "您好" in row["welcome_message"]
    finally:
        os.unlink(db_path)


def test_migration_infers_siliconflow_from_api_base():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        # Overwrite the default row to look like a SiliconFlow agent
        conn = sqlite3.connect(db_path)
        conn.execute(
            "UPDATE agents SET api_base = 'https://api.siliconflow.cn/v1', model = 'gpt-4o-mini' "
            "WHERE id = 'agt_old'"
        )
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM agents WHERE id = 'agt_old'").fetchone()
        conn.close()

        assert row["provider_type"] == "siliconflow"
        assert row["embedding_provider"] == "siliconflow"
    finally:
        os.unlink(db_path)


def test_migration_repairs_illegal_provider_type():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_old_db(db_path)
        # Simulate an agent with a bogus provider_type that exists before migration
        conn = sqlite3.connect(db_path)
        conn.execute("ALTER TABLE agents ADD COLUMN provider_type VARCHAR(50)")
        conn.execute("UPDATE agents SET provider_type = 'bogus_value' WHERE id = 'agt_old'")
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM agents WHERE id = 'agt_old'").fetchone()
        conn.close()

        assert row["provider_type"] == "openai"  # inferred from api_base
    finally:
        os.unlink(db_path)


def test_migration_skips_fresh_db():
    """Migration should be a no-op when the DB file does not exist yet."""
    run_sqlite_migrations("sqlite:////nonexistent/path/test.db")
    # Should not raise


_ADMIN_USERS_DDL = """
CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""


def _create_admin_db(db_path: str) -> str:
    conn = sqlite3.connect(db_path)
    conn.executescript(_ADMIN_USERS_DDL)
    conn.execute(
        "INSERT INTO admin_users (id, email, hashed_password, name, role) "
        "VALUES (1, 'readonly@test.com', 'hash', 'ReadOnly User', 'readonly')"
    )
    conn.execute(
        "INSERT INTO admin_users (id, email, hashed_password, name, role) "
        "VALUES (2, 'admin@test.com', 'hash', 'Admin User', 'admin')"
    )
    conn.commit()
    conn.close()
    return db_path


def test_migration_converts_readonly_to_support():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_admin_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = {
            row["id"]: row["role"]
            for row in conn.execute("SELECT id, role FROM admin_users").fetchall()
        }
        conn.close()

        assert rows[1] == "support"  # readonly → support
        assert rows[2] == "admin"  # admin unchanged
    finally:
        os.unlink(db_path)


def test_migration_readonly_to_support_is_idempotent():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_admin_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")
        run_sqlite_migrations(f"sqlite:///{db_path}")  # second run

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT role FROM admin_users WHERE id = 1"
        ).fetchone()
        conn.close()

        assert row["role"] == "support"
    finally:
        os.unlink(db_path)
