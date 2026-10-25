"""Shared, idempotent SQLite startup migration module.

Called by both ``database.py:init_db()`` and ``docker-entrypoint.py:migrate_sqlite_schema()``
so that the same set of columns / indexes / backfills is applied regardless of
startup path and the two lists can never drift apart.

Uses only the standard library so it can be imported before SQLAlchemy models
are fully loaded.
"""

import os
import sqlite3

# ---- URL parsing ------------------------------------------------------------


def _sqlite_db_path(database_url: str) -> str | None:
    """Extract the filesystem path from a SQLite database URL."""
    raw = (database_url or "").strip()
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if raw.startswith(prefix):
            rest = raw[len(prefix) :]
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
    columns: list[tuple[str, str]],
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

        # ── knowledge bases (workspace scope + KB-owned embedding config) ──
        _migrate_knowledge_bases(cursor)

        # ── agent_members ─────────────────────────────────────────────────
        if _table_exists(cursor, "agents") and _table_exists(cursor, "admin_users"):
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_members (
                    id INTEGER PRIMARY KEY,
                    agent_id VARCHAR(50) NOT NULL,
                    admin_user_id INTEGER NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'admin',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(agent_id) REFERENCES agents(id),
                    FOREIGN KEY(admin_user_id) REFERENCES admin_users(id),
                    UNIQUE(agent_id, admin_user_id)
                )
                """
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS ix_agent_members_agent_id ON agent_members(agent_id)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS ix_agent_members_admin_user_id ON agent_members(admin_user_id)"
            )
            # Note: we no longer auto-insert AgentMember for super_admins on all agents
            # Super admins now use workspace-based auth (agent.workspace_id == admin.workspace_id)
            # This avoids cross-workspace membership that would bypass workspace isolation

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
                "UPDATE workspace_quotas SET max_agents = 10 WHERE max_agents IS NULL OR max_agents < 10"
            )
            if cursor.rowcount > 0:
                print(
                    f"✓ Backfilled workspace_quotas.max_agents for "
                    f"{cursor.rowcount} row(s)"
                )
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
            _ensure_columns(
                cursor,
                "admin_users",
                [("role", "VARCHAR(50) NOT NULL DEFAULT 'admin'")],
            )
            cursor.execute(
                "UPDATE admin_users SET role = 'support' WHERE role = 'readonly'"
            )
            if cursor.rowcount > 0:
                print(
                    f"✓ Migrated {cursor.rowcount} admin_user(s) from readonly to support"
                )

        # ── admin_users workspace_id migration ──────────────────────────────
        if _table_exists(cursor, "admin_users") and _table_exists(cursor, "workspaces"):
            _ensure_columns(
                cursor,
                "admin_users",
                [("workspace_id", "INTEGER REFERENCES workspaces(id)")],
            )
            # Create index if not exists
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS ix_admin_users_workspace_id ON admin_users(workspace_id)"
            )

            # Ensure at least one workspace exists
            cursor.execute("SELECT id FROM workspaces ORDER BY id LIMIT 1")
            row = cursor.fetchone()
            if row:
                canonical_workspace_id = row[0]
            else:
                # Create default workspace if none exists
                cursor.execute(
                    "INSERT INTO workspaces (name, owner_email, created_at) VALUES ('Default Workspace', 'admin@basjoo.local', CURRENT_TIMESTAMP)"
                )
                canonical_workspace_id = cursor.lastrowid
                print(f"✓ Created default workspace with id={canonical_workspace_id}")

                # Ensure quota for this workspace
                if _table_exists(cursor, "workspace_quotas"):
                    cursor.execute(
                        "INSERT OR IGNORE INTO workspace_quotas (workspace_id, max_agents, max_urls, max_qa_items, max_messages_per_day, max_total_text_mb) VALUES (?, 10, 500, 100, 1500, 20)",
                        (canonical_workspace_id,),
                    )
                    if cursor.rowcount > 0:
                        print(
                            f"✓ Created workspace_quotas for workspace {canonical_workspace_id}"
                        )

            # Backfill null workspace_id for ALL admin users (super_admin, admin, support)
            # Legacy installs had no workspace_id column; all users need to be assigned to canonical workspace
            cursor.execute(
                "UPDATE admin_users SET workspace_id = ? WHERE workspace_id IS NULL",
                (canonical_workspace_id,),
            )
            admin_backfill_count = cursor.rowcount
            if admin_backfill_count > 0:
                print(
                    f"✓ Backfilled workspace_id for {admin_backfill_count} admin user(s)"
                )

            # Clean up old cross-workspace AgentMember records BEFORE consolidating agents
            # (agents still have their original workspace assignments at this point)
            # Old code did CROSS JOIN for super_admin × all agents, which now violates workspace isolation
            # Only delete super_admin memberships - admin/support assignments should be preserved
            if _table_exists(cursor, "agent_members") and _table_exists(
                cursor, "agents"
            ):
                # Delete AgentMember rows for super_admin where workspace mismatch
                # These were created by legacy CROSS JOIN and would bypass workspace isolation after role downgrade
                cursor.execute(
                    """
                    DELETE FROM agent_members
                    WHERE id IN (
                        SELECT am.id
                        FROM agent_members am
                        JOIN admin_users au ON am.admin_user_id = au.id
                        JOIN agents a ON am.agent_id = a.id
                        WHERE au.role = 'super_admin'
                          AND au.workspace_id IS NOT NULL
                          AND a.workspace_id IS NOT NULL
                          AND au.workspace_id != a.workspace_id
                    )
                    """
                )
                cross_workspace_members_deleted = cursor.rowcount
                if cross_workspace_members_deleted > 0:
                    print(
                        f"✓ Cleaned up {cross_workspace_members_deleted} super_admin cross-workspace AgentMember record(s) from legacy install"
                    )

            # Agent workspace_id handling
            if _table_exists(cursor, "agents"):
                # Legacy installs (pre-workspace-scoped super_admin) had one workspace per agent.
                # If we just backfilled admin workspace_id, consolidate agents to canonical workspace.
                # Newer installs with existing workspace assignments are preserved.
                if admin_backfill_count > 0:
                    # This is likely a legacy install - consolidate all agents to canonical workspace
                    cursor.execute(
                        "UPDATE agents SET workspace_id = ?", (canonical_workspace_id,)
                    )
                    if cursor.rowcount > 0:
                        print(
                            f"✓ Consolidated {cursor.rowcount} agent(s) to workspace {canonical_workspace_id} (legacy install migration)"
                        )
                else:
                    # Newer install - only backfill NULL workspace_ids, preserve existing assignments
                    cursor.execute(
                        "UPDATE agents SET workspace_id = ? WHERE workspace_id IS NULL",
                        (canonical_workspace_id,),
                    )
                    if cursor.rowcount > 0:
                        print(
                            f"✓ Backfilled workspace_id for {cursor.rowcount} agent(s) with NULL workspace_id"
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
    columns: list[tuple[str, str]] = [
        # LLM / provider
        ("agent_type", "VARCHAR(50) DEFAULT 'website_support'"),
        ("channel_mode", "VARCHAR(50) DEFAULT 'web_widget'"),
        ("avatar", "VARCHAR(500)"),
        ("deleted_at", "DATETIME"),
        ("purge_after", "DATETIME"),
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
        ("kb_id", "VARCHAR(36)"),
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
        (
            "welcome_message",
            "TEXT DEFAULT '您好！我是Basjoo助手，有什么可以帮您的吗？'",
        ),
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
    if "agent_type" in col_names:
        cursor.execute(
            "UPDATE agents SET agent_type = 'website_support' "
            "WHERE agent_type IS NULL OR agent_type = ''"
        )
    if "channel_mode" in col_names:
        cursor.execute(
            "UPDATE agents SET channel_mode = 'web_widget' "
            "WHERE channel_mode IS NULL OR channel_mode = ''"
        )

    # ── top_k ────────────────────────────────────────────────────────────────
    if "top_k" in col_names:
        cursor.execute("UPDATE agents SET top_k = 5 WHERE top_k IS NULL")

    # ── similarity_threshold ─────────────────────────────────────────────────
    if "similarity_threshold" in col_names:
        # RRF scores are typically ≈0.01–0.05; old default 0.3 filters everything
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
        cursor.execute("UPDATE agents SET history_days = 30 WHERE history_days IS NULL")

    # ── boolean flags that should default to false ───────────────────────────
    for flag_col in ("enable_auto_fetch", "enable_context"):
        if flag_col in col_names:
            cursor.execute(f"UPDATE agents SET {flag_col} = 0 WHERE {flag_col} IS NULL")

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

# ---- knowledge base migration ----------------------------------------------

def _fallback_embedding_dimension(model: str | None) -> int:
    """Stdlib mirror of ``services.qdrant_service.get_embedding_dimension``.

    The migration module must stay importable without the app's dependencies, so
    the mapping is duplicated here. Used only to backfill ``embedding_dimension``
    for rows created before the column existed.
    """
    name = (model or "").lower()
    if "text-embedding-3-large" in name:
        return 3072
    if "text-embedding-3-small" in name or "ada" in name:
        return 1536
    if "jina-embeddings-v2-base-en" in name:
        return 768
    return 1024

def _resolve_embedding_dimension(model: str | None) -> int:
    """Prefer the live mapping; fall back to the stdlib copy if unavailable."""
    try:
        from services.qdrant_service import get_embedding_dimension

        return get_embedding_dimension(model or "")
    except Exception:
        return _fallback_embedding_dimension(model)

def _migrate_knowledge_bases(cursor: sqlite3.Cursor) -> None:
    """Move the KB to workspace scope and make it own its embedding config.

    Order matters: columns first, then backfills, then dedupe, then the partial
    unique index on ``agents.kb_id`` (which would reject the legacy duplicates).
    Every step is idempotent.
    """
    if not _table_exists(cursor, "knowledge_bases"):
        return

    # 1. New columns.
    added = _ensure_columns(
        cursor,
        "knowledge_bases",
        [
            ("workspace_id", "INTEGER"),
            ("embedding_provider", "TEXT DEFAULT 'jina'"),
            ("embedding_api_key", "TEXT"),
            ("embedding_batch_size", "INTEGER DEFAULT 4"),
            ("embedding_dimension", "INTEGER"),
        ],
    )
    if added:
        print(f"✓ Added {added} column(s) to knowledge_bases")

    if _table_exists(cursor, "kb_documents"):
        added = _ensure_columns(cursor, "kb_documents", [("source_agent_id", "TEXT")])
        if added:
            print(f"✓ Added {added} column(s) to kb_documents")

    has_agents = _table_exists(cursor, "agents")
    has_workspaces = _table_exists(cursor, "workspaces")

    # 2. Backfill workspace_id from the bound agent, else the canonical workspace.
    if has_agents:
        cursor.execute(
            """
            UPDATE knowledge_bases
            SET workspace_id = (
                SELECT agents.workspace_id FROM agents
                WHERE agents.kb_id = knowledge_bases.id
                LIMIT 1
            )
            WHERE workspace_id IS NULL
            """
        )
        if cursor.rowcount > 0:
            print(f"✓ Backfilled workspace_id for {cursor.rowcount} knowledge base(s)")

    if has_workspaces:
        cursor.execute(
            """
            UPDATE knowledge_bases
            SET workspace_id = (SELECT MIN(id) FROM workspaces)
            WHERE workspace_id IS NULL
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled workspace_id for {cursor.rowcount} unbound knowledge base(s)"
            )

    # 3. Workspace index (create_all builds it on fresh installs).
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_knowledge_bases_workspace_id "
        "ON knowledge_bases(workspace_id)"
    )

    # 4. Copy the embedding config off the bound agent, only where the KB has no
    # real value yet. The KB column defaults (`jina`, `BAAI/bge-m3`, batch size 4)
    # are what the new columns hold on rows that predate them, so they count as
    # "no value": the agent that was actually serving the KB had the live config.
    if has_agents:
        cursor.execute(
            """
            UPDATE knowledge_bases
            SET embedding_provider = (
                SELECT agents.embedding_provider FROM agents
                WHERE agents.kb_id = knowledge_bases.id LIMIT 1
            )
            WHERE (embedding_provider IS NULL OR embedding_provider = ''
                   OR embedding_provider = 'jina')
              AND EXISTS (
                SELECT 1 FROM agents
                WHERE agents.kb_id = knowledge_bases.id
                  AND agents.embedding_provider IS NOT NULL
                  AND agents.embedding_provider != ''
              )
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled embedding_provider for {cursor.rowcount} knowledge base(s)"
            )

        cursor.execute(
            """
            UPDATE knowledge_bases
            SET embedding_model = (
                SELECT agents.embedding_model FROM agents
                WHERE agents.kb_id = knowledge_bases.id LIMIT 1
            )
            WHERE (embedding_model IS NULL OR embedding_model = ''
                   OR embedding_model = 'BAAI/bge-m3')
              AND EXISTS (
                SELECT 1 FROM agents
                WHERE agents.kb_id = knowledge_bases.id
                  AND agents.embedding_model IS NOT NULL
                  AND agents.embedding_model != ''
              )
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled embedding_model for {cursor.rowcount} knowledge base(s)"
            )

        cursor.execute(
            """
            UPDATE knowledge_bases
            SET embedding_base_url = (
                SELECT agents.embedding_api_base FROM agents
                WHERE agents.kb_id = knowledge_bases.id LIMIT 1
            )
            WHERE (embedding_base_url IS NULL OR embedding_base_url = '')
              AND EXISTS (
                SELECT 1 FROM agents
                WHERE agents.kb_id = knowledge_bases.id
                  AND agents.embedding_api_base IS NOT NULL
                  AND agents.embedding_api_base != ''
              )
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled embedding_base_url for {cursor.rowcount} knowledge base(s)"
            )

        cursor.execute(
            """
            UPDATE knowledge_bases
            SET embedding_batch_size = (
                SELECT agents.embedding_batch_size FROM agents
                WHERE agents.kb_id = knowledge_bases.id LIMIT 1
            )
            WHERE (embedding_batch_size IS NULL OR embedding_batch_size = 4)
              AND EXISTS (
                SELECT 1 FROM agents
                WHERE agents.kb_id = knowledge_bases.id
                  AND agents.embedding_batch_size IS NOT NULL
                  AND agents.embedding_batch_size != 4
              )
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled embedding_batch_size for {cursor.rowcount} knowledge base(s)"
            )

        # Keys are already Fernet-encrypted with the same `enc:` marker — copy
        # verbatim, never decrypt in SQL.
        cursor.execute(
            """
            UPDATE knowledge_bases
            SET embedding_api_key = (
                SELECT CASE
                    WHEN agents.embedding_provider = 'jina' THEN agents.jina_api_key
                    WHEN agents.embedding_provider = 'siliconflow' THEN agents.siliconflow_api_key
                    ELSE COALESCE(agents.jina_api_key, agents.siliconflow_api_key)
                END
                FROM agents
                WHERE agents.kb_id = knowledge_bases.id LIMIT 1
            )
            WHERE embedding_api_key IS NULL
              AND EXISTS (
                SELECT 1 FROM agents
                WHERE agents.kb_id = knowledge_bases.id
                  AND COALESCE(
                        CASE
                            WHEN agents.embedding_provider = 'jina' THEN agents.jina_api_key
                            WHEN agents.embedding_provider = 'siliconflow' THEN agents.siliconflow_api_key
                            ELSE COALESCE(agents.jina_api_key, agents.siliconflow_api_key)
                        END,
                        ''
                  ) != ''
              )
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled embedding_api_key for {cursor.rowcount} knowledge base(s)"
            )

    # 5. Provenance for legacy URL documents. Manual uploads stay NULL (unknown).
    if _table_exists(cursor, "kb_documents") and has_agents:
        cursor.execute(
            r"""
            UPDATE kb_documents
            SET source_agent_id = (
                SELECT agents.id FROM agents
                WHERE agents.kb_id = kb_documents.kb_id LIMIT 1
            )
            WHERE source_agent_id IS NULL
              AND filename LIKE 'url\_%' ESCAPE '\'
            """
        )
        if cursor.rowcount > 0:
            print(
                f"✓ Backfilled source_agent_id for {cursor.rowcount} URL document(s)"
            )

    # 5b. Measured width for rows created before the column existed.
    cursor.execute(
        "SELECT id, embedding_model FROM knowledge_bases "
        "WHERE embedding_dimension IS NULL"
    )
    rows = cursor.fetchall()
    for kb_id, model in rows:
        cursor.execute(
            "UPDATE knowledge_bases SET embedding_dimension = ? WHERE id = ?",
            (_resolve_embedding_dimension(model), kb_id),
        )
    if rows:
        print(f"✓ Backfilled embedding_dimension for {len(rows)} knowledge base(s)")

    # 6. One KB ⇄ one agent: drop the extra bindings before the unique index.
    if has_agents:
        cursor.execute(
            """
            SELECT kb_id FROM agents
            WHERE kb_id IS NOT NULL
            GROUP BY kb_id
            HAVING COUNT(*) > 1
            """
        )
        duplicate_kb_ids = [row[0] for row in cursor.fetchall()]
        dropped = 0
        for kb_id in duplicate_kb_ids:
            cursor.execute(
                """
                SELECT rowid, id, created_at FROM agents
                WHERE kb_id = ?
                ORDER BY COALESCE(created_at, ''), rowid
                """,
                (kb_id,),
            )
            bindings = cursor.fetchall()
            for row in bindings[1:]:
                cursor.execute(
                    "UPDATE agents SET kb_id = NULL WHERE rowid = ?", (row[0],)
                )
                dropped += 1
        if dropped:
            print(
                f"✓ Dropped {dropped} duplicate KB binding(s) "
                f"across {len(duplicate_kb_ids)} knowledge base(s)"
            )

        # 7. Partial unique index: fresh installs get it from `Agent.kb_id unique=True`.
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_kb_id "
            "ON agents(kb_id) WHERE kb_id IS NOT NULL"
        )
