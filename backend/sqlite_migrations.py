"""Shared, idempotent SQLite startup migration module.

Called by both ``database.py:init_db()`` and ``docker-entrypoint.py:migrate_sqlite_schema()``
so that the same set of columns / indexes / backfills is applied regardless of
startup path and the two lists can never drift apart.

Uses only the standard library so it can be imported before SQLAlchemy models
are fully loaded.
"""

import os
import sqlite3
from typing import List, Optional, Tuple

# ---- URL parsing ------------------------------------------------------------


def _sqlite_db_path(database_url: str) -> Optional[str]:
    """Extract the filesystem path from a SQLite database URL."""
    raw = (database_url or "").strip()
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if raw.startswith(prefix):
            rest = raw[len(prefix):]
            # Strip query strings like ?cache=shared
            path = rest.split("?", 1)[0]
            # Resolve relative paths against CWD
            if not path.startswith("/"):
                path = os.path.abspath(path)
            return path
    return None


# ---- schema migration -------------------------------------------------------


def _ensure_columns(
    cursor: sqlite3.Cursor,
    table: str,
    columns: List[Tuple[str, str]],
) -> int:
    """Add any missing columns to *table* (idempotent).  Returns count of columns added."""
    cursor.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cursor.fetchall()}
    added = 0
    for col_name, col_type in columns:
        if col_name not in existing:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
            added += 1
    return added



_DEFAULT_SIMILARITY_THRESHOLD = 0.01


def run_sqlite_migrations(database_url: str) -> None:
    """Apply all pending SQLite migrations idempotently.

    If the database file does not exist yet this is a no-op — the tables have
    not been created and ``Base.metadata.create_all`` will create the full
    schema later.
    """
    db_path = _sqlite_db_path(database_url)
    if not db_path:
        return  # not SQLite

    if not os.path.exists(db_path):
        return  # fresh deployment, schema will be created by create_all

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # ── agents ────────────────────────────────────────────────────────
        if _table_exists(cursor, "agents"):
            _migrate_agents(cursor)

            # Dedicated per-column backfills (after all columns definitely exist)
            _backfill_agents(cursor)

        # ── chat_sessions ──────────────────────────────────────────────────
        if _table_exists(cursor, "chat_sessions"):
            _ensure_columns(
                cursor,
                "chat_sessions",
                [
                    ("visitor_ip", "TEXT"),
                    ("visitor_user_agent", "TEXT"),
                    ("visitor_country", "TEXT"),
                    ("visitor_region", "TEXT"),
                    ("visitor_city", "TEXT"),
                ],
            )

        # ── chat_messages ──────────────────────────────────────────────────
        if _table_exists(cursor, "chat_messages"):
            _ensure_columns(
                cursor,
                "chat_messages",
                [
                    ("sender_type", "TEXT"),
                    ("sender_id", "TEXT"),
                ],
            )

        # ── url_sources ───────────────────────────────────────────────────
        if _table_exists(cursor, "url_sources"):
            _ensure_columns(
                cursor,
                "url_sources",
                [
                    ("r2r_document_id", "VARCHAR(100)"),
                ],
            )

        # ── uq_chat_sessions_active_session unique index ───────────────────
        if _table_exists(cursor, "chat_sessions"):
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND name='uq_chat_sessions_active_session'"
            )
            if not cursor.fetchone():
                cursor.execute(
                    """
                    DELETE FROM chat_sessions
                    WHERE status != 'closed'
                      AND id NOT IN (
                        SELECT id FROM (
                            SELECT MAX(id) AS id
                            FROM chat_sessions
                            WHERE status != 'closed'
                            GROUP BY agent_id, session_id
                        )
                    )
                    """
                )
                cursor.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "uq_chat_sessions_active_session "
                    "ON chat_sessions (agent_id, session_id) "
                    "WHERE status != 'closed'"
                )

        # ── workspace_quotas backfill ──────────────────────────────────────
        if _table_exists(cursor, "workspace_quotas"):
            cursor.execute(
                "UPDATE workspace_quotas SET max_urls = 500 WHERE max_urls = 50"
            )
            if cursor.rowcount > 0:
                print(
                    f"✓ Backfilled workspace_quotas.max_urls for "
                    f"{cursor.rowcount} row(s)"
                )

        # ── admin_users role migration ─────────────────────────────────────
        if _table_exists(cursor, "admin_users"):
            _ensure_columns(cursor, "admin_users", [("role", "VARCHAR(50) NOT NULL DEFAULT 'admin'")])
            cursor.execute(
                "UPDATE admin_users SET role = 'support' WHERE role = 'readonly'"
            )
            if cursor.rowcount > 0:
                print(
                    f"✓ Migrated {cursor.rowcount} admin_user(s) from readonly to support"
                )

        conn.commit()

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---- helpers ----------------------------------------------------------------


def _table_exists(cursor: sqlite3.Cursor, table: str) -> bool:
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cursor.fetchone() is not None


# ---- agents migration -------------------------------------------------------


def _migrate_agents(cursor: sqlite3.Cursor):
    """Add any missing columns to the ``agents`` table.

    The column list mirrors the current ``models.py:Agent`` definition and must
    be kept in sync when the model gains new fields.
    """
    columns: List[Tuple[str, str]] = [
        # LLM / provider
        ("provider_type", "VARCHAR(50)"),
        ("azure_endpoint", "VARCHAR(500)"),
        ("azure_deployment_name", "VARCHAR(100)"),
        ("azure_api_version", "VARCHAR(20)"),
        ("anthropic_version", "VARCHAR(20) DEFAULT '2023-06-01'"),
        ("google_project_id", "VARCHAR(100)"),
        ("google_region", "VARCHAR(50)"),
        ("provider_config", "TEXT"),
        # embedding
        ("siliconflow_api_key", "VARCHAR(500) DEFAULT ''"),
        ("embedding_provider", "VARCHAR(20)"),
        ("embedding_api_base", "VARCHAR(500)"),
        ("embedding_model", "VARCHAR(100) DEFAULT 'jina-embeddings-v3'"),
        ("embedding_batch_size", "INTEGER DEFAULT 4"),
        # kb setup state
        ("kb_setup_completed", "BOOLEAN DEFAULT 0"),
        # crawl / retrieval
        ("crawl_max_depth", "INTEGER DEFAULT 2"),
        ("crawl_max_pages", "INTEGER DEFAULT 500"),
        ("url_fetch_interval_days", "INTEGER DEFAULT 7"),
        ("enable_auto_fetch", "BOOLEAN DEFAULT 0"),
        ("top_k", "INTEGER DEFAULT 5"),
        ("similarity_threshold", f"FLOAT DEFAULT {_DEFAULT_SIMILARITY_THRESHOLD}"),
        ("enable_context", "BOOLEAN DEFAULT 0"),
        # rate-limit / error / widget
        ("restricted_reply", "TEXT DEFAULT '抱歉，当前服务受限，请稍后再试。'"),
        ("last_error_code", "VARCHAR(50)"),
        ("last_error_message", "TEXT"),
        ("last_error_at", "DATETIME"),
        ("allowed_widget_origins", "TEXT"),
        ("persona_type", "VARCHAR(20) DEFAULT 'general'"),
        ("widget_title", "VARCHAR(100) DEFAULT 'AI 客服'"),
        ("widget_color", "VARCHAR(20) DEFAULT '#06B6D4'"),
        ("welcome_message", "TEXT DEFAULT '您好！我是Basjoo助手，有什么可以帮您的吗？'"),
        ("history_days", "INTEGER DEFAULT 30"),
    ]

    # Handle the old column-name migration before we report existing columns
    cursor.execute("PRAGMA table_info(agents)")
    existing = {row[1] for row in cursor.fetchall()}

    if "rate_limit_per_hour" in existing and "rate_limit_per_minute" not in existing:
        cursor.execute(
            "ALTER TABLE agents RENAME COLUMN rate_limit_per_hour TO rate_limit_per_minute"
        )
        print("✓ Renamed rate_limit_per_hour → rate_limit_per_minute")
        existing.discard("rate_limit_per_hour")
        existing.add("rate_limit_per_minute")

    # Also add rate_limit_per_minute if it's simply missing (not a rename scenario)
    if "rate_limit_per_minute" not in existing:
        columns.insert(0, ("rate_limit_per_minute", "INTEGER DEFAULT 20"))

    # Add any still-missing columns
    added = _ensure_columns(cursor, "agents", columns)
    if added:
        print(f"✓ Added {added} column(s) to agents")


def _backfill_agents(cursor: sqlite3.Cursor):
    """Backfill safe defaults for existing agent rows."""

    cursor.execute("PRAGMA table_info(agents)")
    col_names = {row[1] for row in cursor.fetchall()}

    # ── provider_type (must come first so embedding_provider can use it) ─────
    if "provider_type" in col_names:
        # First repair values that aren't in the current Literal set
        cursor.execute(
            "UPDATE agents SET provider_type = NULL "
            "WHERE provider_type IS NOT NULL "
            "AND provider_type NOT IN ('openai','openai_native','google','anthropic','xai','openrouter','zai','deepseek','volcengine','moonshot','aliyun_bailian','siliconflow')"
        )
        # Then infer from api_base/model for NULL/empty rows
        cursor.execute(
            "UPDATE agents SET provider_type = "
            "CASE "
            "  WHEN api_base LIKE '%deepseek%' OR model LIKE 'deepseek%' THEN 'deepseek'"
            "  WHEN api_base LIKE '%siliconflow%' THEN 'siliconflow'"
            "  WHEN api_base LIKE '%google%' OR api_base LIKE '%gemini%' THEN 'google'"
            "  WHEN api_base LIKE '%anthropic%' OR api_base LIKE '%claude%' THEN 'anthropic'"
            "  WHEN api_base LIKE '%x.ai%' OR api_base LIKE '%xai%' THEN 'xai'"
            "  WHEN api_base LIKE '%openai%' OR api_base LIKE '%azure%' THEN 'openai'"
            "  ELSE 'openai' END "
            "WHERE provider_type IS NULL OR provider_type = ''"
        )

    # ── embedding_provider (now provider_type is correct) ────────────────────
    if "embedding_provider" in col_names:
        # First repair non-standard values
        cursor.execute(
            "UPDATE agents SET embedding_provider = NULL "
            "WHERE embedding_provider NOT IN ('jina', 'siliconflow', 'custom')"
        )
        if "provider_type" in col_names:
            cursor.execute(
                "UPDATE agents SET embedding_provider = 'siliconflow' "
                "WHERE provider_type = 'siliconflow' "
                "AND (embedding_provider IS NULL OR embedding_provider = '')"
            )
        cursor.execute(
            "UPDATE agents SET embedding_provider = 'jina' "
            "WHERE embedding_provider IS NULL OR embedding_provider = ''"
        )

    # ── embedding_model ──────────────────────────────────────────────────────
    if "embedding_model" in col_names:
        cursor.execute(
            "UPDATE agents SET embedding_model = 'jina-embeddings-v3' "
            "WHERE embedding_model IS NULL OR embedding_model = ''"
        )

    # ── persona_type ─────────────────────────────────────────────────────────
    if "persona_type" in col_names:
        cursor.execute(
            "UPDATE agents SET persona_type = 'general' "
            "WHERE persona_type IS NULL OR persona_type = ''"
        )

    # ── top_k ────────────────────────────────────────────────────────────────
    if "top_k" in col_names:
        cursor.execute(
            "UPDATE agents SET top_k = 5 WHERE top_k IS NULL"
        )

    # ── similarity_threshold ─────────────────────────────────────────────────
    if "similarity_threshold" in col_names:
        # R2R uses RRF scores (≈0.01–0.05); old default 0.3 filters everything
        cursor.execute(
            "UPDATE agents SET similarity_threshold = ? "
            "WHERE similarity_threshold IS NULL OR similarity_threshold = 0.3",
            (_DEFAULT_SIMILARITY_THRESHOLD,),
        )

    # ── rate_limit_per_minute ────────────────────────────────────────────────
    if "rate_limit_per_minute" in col_names:
        cursor.execute(
            "UPDATE agents SET rate_limit_per_minute = 20 "
            "WHERE rate_limit_per_minute IS NULL"
        )

    # ── history_days ─────────────────────────────────────────────────────────
    if "history_days" in col_names:
        cursor.execute(
            "UPDATE agents SET history_days = 30 WHERE history_days IS NULL"
        )

    # ── boolean flags that should default to false ───────────────────────────
    for flag_col in ("enable_auto_fetch", "enable_context"):
        if flag_col in col_names:
            cursor.execute(
                f"UPDATE agents SET {flag_col} = 0 WHERE {flag_col} IS NULL"
            )

    # ── crawl defaults ───────────────────────────────────────────────────────
    if "crawl_max_depth" in col_names:
        cursor.execute(
            "UPDATE agents SET crawl_max_depth = 2 WHERE crawl_max_depth IS NULL"
        )
    if "crawl_max_pages" in col_names:
        cursor.execute(
            "UPDATE agents SET crawl_max_pages = 500 WHERE crawl_max_pages IS NULL"
        )
    if "url_fetch_interval_days" in col_names:
        cursor.execute(
            "UPDATE agents SET url_fetch_interval_days = 7 "
            "WHERE url_fetch_interval_days IS NULL"
        )

    # ── widget defaults ──────────────────────────────────────────────────────
    if "widget_title" in col_names:
        cursor.execute(
            "UPDATE agents SET widget_title = 'AI 客服' "
            "WHERE widget_title IS NULL OR widget_title = ''"
        )
    if "widget_color" in col_names:
        cursor.execute(
            "UPDATE agents SET widget_color = '#06B6D4' "
            "WHERE widget_color IS NULL OR widget_color = ''"
        )
    if "welcome_message" in col_names:
        cursor.execute(
            "UPDATE agents SET welcome_message = '您好！我是Basjoo助手，有什么可以帮您的吗？' "
            "WHERE welcome_message IS NULL OR welcome_message = ''"
        )

    restricted_reply_default = "抱歉，当前服务受限，请稍后再试。"
    if "restricted_reply" in col_names:
        cursor.execute(
            "UPDATE agents SET restricted_reply = ? "
            "WHERE restricted_reply IS NULL OR restricted_reply = ''",
            (restricted_reply_default,),
        )
