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

        # ── agents: drop the retired agent_type / channel_mode columns ─────
        _drop_retired_agent_columns(cursor)

        # ── workspaces: built-in example seed lifecycle ────────────────────
        if _table_exists(cursor, "workspaces"):
            _migrate_workspaces(cursor)

        # ── knowledge bases (workspace scope + KB-owned embedding config) ──
        _migrate_knowledge_bases(cursor)

        # ── url_sources (agent scope → KB scope, issue #15/#16) ────────────
        _migrate_url_sources(cursor)

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
                    # #43 — human handoff without takeover.
                    ("mode", "VARCHAR(10) DEFAULT 'ai'"),
                    ("human_replied_at", "DATETIME"),
                    # #39 — one procedure step per turn.
                    ("active_procedure_id", "VARCHAR(36)"),
                    ("procedure_step", "INTEGER DEFAULT 0"),
                    # #41 — lead capture + transcript idempotency.
                    ("contact_email", "VARCHAR(255)"),
                    ("contact_name", "VARCHAR(100)"),
                    ("transcript_sent_at", "DATETIME"),
                    # #45 — async classification.
                    ("topic", "VARCHAR(100)"),
                    ("sentiment", "VARCHAR(20)"),
                    ("outcome", "VARCHAR(20)"),
                    # #44 — spam-check sampling counts answered turns.
                    ("ai_turn_count", "INTEGER DEFAULT 0"),
                ],
            )
            # Existing rows: every session is AI-handled until a human replies.
            cursor.execute(
                "UPDATE chat_sessions SET mode = 'ai' WHERE mode IS NULL OR mode = ''"
            )
            cursor.execute(
                "UPDATE chat_sessions SET ai_turn_count = 0 WHERE ai_turn_count IS NULL"
            )

        # ── chat_messages ──────────────────────────────────────────────────
        if _table_exists(cursor, "chat_messages"):
            _ensure_columns(
                cursor,
                "chat_messages",
                [
                    ("sender_type", "TEXT"),
                    ("sender_id", "TEXT"),
                    # #42 — answer quality, no backfill: existing rows stay
                    # confidence NULL / is_unanswered false.
                    ("confidence", "FLOAT"),
                    ("is_unanswered", "BOOLEAN DEFAULT 0"),
                    # #41 — thumbs vote (-1/0/+1).
                    ("rating", "INTEGER"),
                    # #45 — the degraded flag #44 already returns on the
                    # response, persisted so analytics can count it. Existing
                    # rows read as 0 (a primary answer; the column did not
                    # exist to be degraded before).
                    ("degraded", "BOOLEAN DEFAULT 0"),
                ],
            )
            cursor.execute(
                "UPDATE chat_messages SET degraded = 0 WHERE degraded IS NULL"
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

        # ── new tables (#39, #41, #47) ──────────────────────────────────────
        _create_feature_tables(cursor)

        conn.commit()

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---- helpers ----------------------------------------------------------------

def _create_feature_tables(cursor: sqlite3.Cursor) -> None:
    """Create tables added after the original schema (all idempotent).

    ``Base.metadata.create_all`` builds these on a fresh install; an existing
    database needs the DDL here, because create_all does not add tables to an
    already-populated file. Column types mirror ``models.py`` exactly.
    """
    if _table_exists(cursor, "knowledge_bases"):
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS qa_items (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                kb_id VARCHAR(36) NOT NULL REFERENCES knowledge_bases(id),
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT 1,
                hits INTEGER NOT NULL DEFAULT 0,
                last_hit_at DATETIME,
                source VARCHAR(20) NOT NULL DEFAULT 'manual',
                source_message_id INTEGER,
                embedding_hash VARCHAR(64),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME,
                CONSTRAINT uq_qa_items_kb_question UNIQUE (kb_id, question)
            )
            """
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_qa_items_kb_id ON qa_items(kb_id)"
        )

    if _table_exists(cursor, "agents"):
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS procedures (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                agent_id VARCHAR(50) NOT NULL REFERENCES agents(id),
                name VARCHAR(200) NOT NULL,
                steps TEXT NOT NULL DEFAULT '[]',
                enabled BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME
            )
            """
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_procedures_agent_id ON procedures(agent_id)"
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS leads (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                agent_id VARCHAR(50) NOT NULL REFERENCES agents(id),
                workspace_id INTEGER REFERENCES workspaces(id),
                session_id VARCHAR(50),
                name VARCHAR(100),
                email VARCHAR(255),
                phone VARCHAR(50),
                message TEXT,
                source VARCHAR(20) NOT NULL DEFAULT 'offline-form',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_leads_agent_id ON leads(agent_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_leads_email ON leads(email)")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_leads_session_id ON leads(session_id)"
        )
        # #41 — operator triage + the page the form was submitted from. Added to
        # the existing table with `_ensure_columns`, so a database that already
        # ran the batch schema gains them without a rebuild.
        _ensure_columns(
            cursor,
            "leads",
            [
                ("page_url", "VARCHAR(1000)"),
                ("contacted", "BOOLEAN DEFAULT 0"),
                ("contacted_at", "DATETIME"),
                ("updated_at", "DATETIME"),
            ],
        )
        cursor.execute(
            "UPDATE leads SET contacted = 0 WHERE contacted IS NULL"
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS webhooks (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                agent_id VARCHAR(50) NOT NULL REFERENCES agents(id),
                url VARCHAR(1000) NOT NULL,
                events TEXT NOT NULL DEFAULT '[]',
                enabled BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_webhooks_agent_id ON webhooks(agent_id)"
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS webhook_deliveries (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                agent_id VARCHAR(50) NOT NULL REFERENCES agents(id),
                event VARCHAR(50) NOT NULL,
                payload TEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                next_attempt_at DATETIME,
                delivered_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_agent_id "
            "ON webhook_deliveries(agent_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_event "
            "ON webhook_deliveries(event)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_status "
            "ON webhook_deliveries(status)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_status_created "
            "ON webhook_deliveries(status, created_at)"
        )


def _table_exists(cursor: sqlite3.Cursor, table: str) -> bool:
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cursor.fetchone() is not None


# ---- agents migration -------------------------------------------------------

def _migrate_workspaces(cursor: sqlite3.Cursor) -> None:
    """Add the example-seed lifecycle column (``pending`` | ``seeded`` | ``declined``).

    Existing installations get ``pending``, so the seed retries on the next login
    instead of being permanently suppressed by the old "has any agent" guard.
    """
    added = _ensure_columns(
        cursor,
        "workspaces",
        [("example_seed_state", "VARCHAR(20) NOT NULL DEFAULT 'pending'")],
    )
    cursor.execute(
        "UPDATE workspaces SET example_seed_state = 'pending' "
        "WHERE example_seed_state IS NULL OR example_seed_state = ''"
    )
    if added or cursor.rowcount:
        print(f"✓ Added workspaces.example_seed_state ({added} column, {cursor.rowcount} backfilled)")



def _migrate_agents(cursor: sqlite3.Cursor):
    """Add any missing columns to the ``agents`` table.

    The column list mirrors the current ``models.py:Agent`` definition and must
    be kept in sync when the model gains new fields.
    """
    columns: list[tuple[str, str]] = [
        # LLM / provider
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
        ("widget_color", "VARCHAR(20) DEFAULT '#F9CA02'"),
        (
            "welcome_message",
            "TEXT DEFAULT '您好！我是Basjoo助手，有什么可以帮您的吗？'",
        ),
        ("history_days", "INTEGER DEFAULT 30"),
        # #40 — install surface.
        ("excluded_paths", "TEXT"),
        ("display_mode", "VARCHAR(20) DEFAULT 'bubble'"),
        ("inline_container", "VARCHAR(200)"),
        ("starters", "TEXT"),
        ("widget_cards", "TEXT"),
        ("traffic_percentage", "INTEGER DEFAULT 100"),
        # #43 / #41 — conversation policy.
        ("escalation_rules", "TEXT"),
        ("business_hours", "TEXT"),
        ("away_message", "TEXT"),
        ("ai_disclosure", "TEXT"),
        # #41 — prechat form policy: off | optional | required.
        ("prechat_mode", "VARCHAR(20) DEFAULT 'off'"),
        # #39 — answer control.
        ("fixed_facts", "TEXT"),
        # #44 — quota degradation.
        ("fallback_model", "VARCHAR(100)"),
        ("fallback_api_key", "VARCHAR(500)"),
        # #46 — signed visitor identity.
        ("identity_secret", "VARCHAR(500)"),
        # #47 — outbound webhooks: endpoint + Fernet-encrypted signing secret.
        ("webhook_url", "VARCHAR(1000)"),
        ("webhook_secret", "VARCHAR(500)"),
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

    # Rows created before the single-default-colour change carry one of the two
    # old defaults ('#06B6D4' model default, '#00aaff' dashboard constant) —
    # neither was ever an operator choice, so both move to the accent. A colour
    # the operator actually picked is left alone.
    cursor.execute(
        "UPDATE agents SET widget_color = '#F9CA02' "
        "WHERE LOWER(widget_color) IN ('#06b6d4', '#00aaff')"
    )
    if cursor.rowcount > 0:
        print(f"✓ Normalised widget_color on {cursor.rowcount} agent(s)")

    # display_mode / traffic_percentage must never be NULL for the widget's
    # "is it installed" check.
    cursor.execute(
        "UPDATE agents SET display_mode = 'bubble' "
        "WHERE display_mode IS NULL OR display_mode = ''"
    )
    cursor.execute(
        "UPDATE agents SET traffic_percentage = 100 WHERE traffic_percentage IS NULL"
    )
    # #41: a prechat form defaults off, so an existing agent behaves exactly as
    # it did before the column existed.
    cursor.execute(
        "UPDATE agents SET prechat_mode = 'off' "
        "WHERE prechat_mode IS NULL OR prechat_mode = ''"
    )



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
            "AND provider_type NOT IN ('openai','openai_native','google','anthropic','xai','openrouter','zai','deepseek','volcengine','moonshot','aliyun_bailian','siliconflow','tencentcloud')"
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
            "UPDATE agents SET widget_color = '#F9CA02' "
            "WHERE widget_color IS NULL OR widget_color = ''"
        )
        # Rows still on one of the two retired defaults never chose that colour
        # — both were shipping defaults, not operator picks — so they move to the
        # console accent. A colour an operator actually picked is left alone.
        cursor.execute(
            "UPDATE agents SET widget_color = '#F9CA02' "
            "WHERE widget_color IN ('#06B6D4', '#00aaff')"
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

# ---- url_sources migration (agent scope -> KB scope) ------------------------

_URL_SOURCES_NEW_DDL = """
CREATE TABLE url_sources_new (
    id INTEGER PRIMARY KEY,
    kb_id VARCHAR(36) NOT NULL REFERENCES knowledge_bases(id),
    url VARCHAR(1000) NOT NULL,
    normalized_url VARCHAR(1000) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    last_fetch_at DATETIME,
    last_error TEXT,
    title VARCHAR(500),
    content TEXT,
    content_hash VARCHAR(64),
    fetch_metadata JSON,
    is_indexed BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
)
"""

def _ensure_url_source_indexes(cursor: sqlite3.Cursor) -> None:
    """Recreate every index/unique constraint the model declares (idempotent)."""
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_url_sources_kb_id ON url_sources(kb_id)"
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS ix_url_sources_url ON url_sources(url)")
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_url_sources_normalized_url "
        "ON url_sources(normalized_url)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_url_sources_status ON url_sources(status)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_url_sources_kb_status "
        "ON url_sources(kb_id, status)"
    )

    # A fresh ``create_all`` install already has the UNIQUE table constraint
    # (SQLite reports it as ``sqlite_autoindex_*``), so only add the named index
    # when no unique index on (kb_id, normalized_url) exists yet.
    cursor.execute("PRAGMA index_list(url_sources)")
    for index_row in cursor.fetchall():
        index_name = index_row[1]
        is_unique = bool(index_row[2])
        if not is_unique:
            continue
        cursor.execute(f"PRAGMA index_info('{index_name}')")
        columns = [row[2] for row in cursor.fetchall()]
        if columns == ["kb_id", "normalized_url"]:
            return
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_normalized_url "
        "ON url_sources(kb_id, normalized_url)"
    )

def _migrate_url_sources(cursor: sqlite3.Cursor) -> None:
    """Rebuild ``url_sources`` from agent scope to KB scope.

    Legacy rows are re-pointed at the KB bound to their agent. Rows whose agent
    has no KB cannot be indexed anywhere and are dropped. The whole block is
    idempotent: a table that already has ``kb_id`` and no ``agent_id`` is left
    untouched apart from re-asserting its indexes.
    """
    if not _table_exists(cursor, "url_sources"):
        return

    cursor.execute("PRAGMA table_info(url_sources)")
    existing = {row[1] for row in cursor.fetchall()}

    if "kb_id" in existing and "agent_id" not in existing:
        _ensure_url_source_indexes(cursor)
        return

    if "agent_id" not in existing:
        # Neither shape known — nothing safe to rebuild from.
        return

    if not _table_exists(cursor, "agents"):
        # Without the agents table the legacy rows cannot be re-pointed at a KB;
        # leaving the table untouched beats dropping every row.
        return

    target_columns = [
        "id",
        "kb_id",
        "url",
        "normalized_url",
        "status",
        "last_fetch_at",
        "last_error",
        "title",
        "content",
        "content_hash",
        "fetch_metadata",
        "is_indexed",
        "created_at",
        "updated_at",
    ]
    source_expressions = {
        "is_indexed": "COALESCE(url_sources.is_indexed, 0)",
    }
    if "kb_id" in existing:
        # Half-migrated install: keep an already-set kb_id instead of dropping
        # the row when its agent happens to be unbound.
        source_expressions["kb_id"] = "COALESCE(agents.kb_id, url_sources.kb_id)"
        bound_filter = "WHERE COALESCE(agents.kb_id, url_sources.kb_id) IS NOT NULL"
    else:
        source_expressions["kb_id"] = "agents.kb_id"
        bound_filter = "WHERE agents.kb_id IS NOT NULL"
    select_list = []
    for column in target_columns:
        if column in source_expressions:
            select_list.append(source_expressions[column])
        elif column in existing:
            select_list.append(f"url_sources.{column}")
        elif column == "status":
            select_list.append("'pending'")
        else:
            select_list.append("NULL")

    cursor.execute("DROP TABLE IF EXISTS url_sources_new")
    cursor.execute(_URL_SOURCES_NEW_DDL)

    cursor.execute(
        f"INSERT INTO url_sources_new ({', '.join(target_columns)}) "
        f"SELECT {', '.join(select_list)} "
        "FROM url_sources "
        "JOIN agents ON url_sources.agent_id = agents.id "
        f"{bound_filter}"
    )
    copied = cursor.rowcount
    print(f"✓ Migrated {copied} url_source row(s) from agent scope to KB scope")

    cursor.execute("DROP TABLE url_sources")
    cursor.execute("ALTER TABLE url_sources_new RENAME TO url_sources")

    # Dedupe before the unique index: a legacy install can bind two agents to
    # one KB, which collapses onto the same (kb_id, normalized_url).
    cursor.execute(
        "DELETE FROM url_sources WHERE id NOT IN ("
        "SELECT MIN(id) FROM url_sources GROUP BY kb_id, normalized_url)"
    )
    if cursor.rowcount > 0:
        print(f"✓ Dropped {cursor.rowcount} duplicate url_source row(s)")

    _ensure_url_source_indexes(cursor)

# ---- agents: drop retired columns -------------------------------------------

def _drop_retired_agent_columns(cursor: sqlite3.Cursor) -> None:
    """Drop ``agents.agent_type`` / ``agents.channel_mode`` (issue #20).

    Idempotent: a column that is already gone is skipped. Any plain index that
    mentions the column is dropped first, because SQLite refuses to drop a
    column that an index depends on. ``sqlite_autoindex_*`` entries belong to
    table constraints and cannot be dropped individually.
    """
    if not _table_exists(cursor, "agents"):
        return

    cursor.execute("PRAGMA table_info(agents)")
    existing = {row[1] for row in cursor.fetchall()}

    for column in ("agent_type", "channel_mode"):
        if column not in existing:
            continue

        cursor.execute("PRAGMA index_list(agents)")
        for index_row in cursor.fetchall():
            index_name = index_row[1]
            if index_name.startswith("sqlite_autoindex_"):
                continue
            cursor.execute(f"PRAGMA index_info('{index_name}')")
            indexed_columns = {row[2] for row in cursor.fetchall()}
            if column in indexed_columns:
                cursor.execute(f"DROP INDEX IF EXISTS {index_name}")

        cursor.execute(f"ALTER TABLE agents DROP COLUMN {column}")
        print(f"✓ Dropped retired agents.{column}")
        existing.discard(column)

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
        # #47 — diffed refetch key + two-phase upload stage.
        added = _ensure_columns(
            cursor,
            "kb_documents",
            [
                ("source_agent_id", "TEXT"),
                ("item_hash", "VARCHAR(64)"),
                ("processing_stage", "VARCHAR(20)"),
            ],
        )
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
