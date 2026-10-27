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


def _create_legacy_workspace_db(db_path: str) -> str:
    """Create a legacy multi-workspace install with cross-workspace AgentMember records."""
    conn = sqlite3.connect(db_path)
    # Create workspaces (legacy: each agent had its own workspace)
    conn.execute("""
        CREATE TABLE workspaces (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            owner_email TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("INSERT INTO workspaces (id, name, owner_email) VALUES (1, 'WS1', 'ws1@test.com')")
    conn.execute("INSERT INTO workspaces (id, name, owner_email) VALUES (2, 'WS2', 'ws2@test.com')")

    # Create workspace_quotas with full schema
    conn.execute("""
        CREATE TABLE workspace_quotas (
            id INTEGER PRIMARY KEY,
            workspace_id INTEGER NOT NULL UNIQUE,
            max_agents INTEGER DEFAULT 10,
            max_urls INTEGER DEFAULT 500,
            max_qa_items INTEGER DEFAULT 100,
            max_messages_per_day INTEGER DEFAULT 1500,
            max_total_text_mb INTEGER DEFAULT 20
        )
    """)
    conn.execute("INSERT INTO workspace_quotas (workspace_id, max_urls) VALUES (1, 500)")
    conn.execute("INSERT INTO workspace_quotas (workspace_id, max_urls) VALUES (2, 500)")

    # Create agents in different workspaces
    conn.execute(OLD_AGENTS_DDL)
    conn.execute("INSERT INTO agents (id, workspace_id, name, model, api_base) VALUES ('agt_1', 1, 'Agent1', 'gpt-4o-mini', 'https://api.openai.com/v1')")
    conn.execute("INSERT INTO agents (id, workspace_id, name, model, api_base) VALUES ('agt_2', 2, 'Agent2', 'gpt-4o-mini', 'https://api.openai.com/v1')")

    # Create admin_users with various roles (no workspace_id column yet)
    conn.execute("""
        CREATE TABLE admin_users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            hashed_password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'admin',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("INSERT INTO admin_users (id, email, hashed_password, name, role) VALUES (1, 'super@test.com', 'hash', 'Super Admin', 'super_admin')")
    conn.execute("INSERT INTO admin_users (id, email, hashed_password, name, role) VALUES (2, 'admin@test.com', 'hash', 'Admin User', 'admin')")
    conn.execute("INSERT INTO admin_users (id, email, hashed_password, name, role) VALUES (3, 'support@test.com', 'hash', 'Support User', 'support')")

    # Create agent_members with legacy CROSS JOIN pattern (super_admin × all agents)
    conn.execute("""
        CREATE TABLE agent_members (
            id INTEGER PRIMARY KEY,
            agent_id TEXT NOT NULL,
            admin_user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'admin',
            UNIQUE(agent_id, admin_user_id)
        )
    """)
    # Legacy auto-insert: super_admin had membership for ALL agents (cross-workspace!)
    conn.execute("INSERT INTO agent_members (agent_id, admin_user_id, role) VALUES ('agt_1', 1, 'admin')")
    conn.execute("INSERT INTO agent_members (agent_id, admin_user_id, role) VALUES ('agt_2', 1, 'admin')")  # cross-workspace
    # Admin user has membership for agent in workspace 1
    conn.execute("INSERT INTO agent_members (agent_id, admin_user_id, role) VALUES ('agt_1', 2, 'admin')")

    conn.commit()
    conn.close()
    return db_path


def test_migration_backfills_workspace_id_for_all_admin_roles():
    """All admin users (super_admin, admin, support) should get workspace_id backfilled."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_workspace_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = {
            row["id"]: row["workspace_id"]
            for row in conn.execute("SELECT id, workspace_id FROM admin_users").fetchall()
        }
        conn.close()

        # All users should be assigned to canonical workspace (first workspace = 1)
        assert rows[1] == 1  # super_admin
        assert rows[2] == 1  # admin
        assert rows[3] == 1  # support
    finally:
        os.unlink(db_path)


def test_migration_consolidates_agents_to_canonical_workspace():
    """Legacy install agents should be consolidated to canonical workspace."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_workspace_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = {
            row["id"]: row["workspace_id"]
            for row in conn.execute("SELECT id, workspace_id FROM agents").fetchall()
        }
        conn.close()

        # All agents should be consolidated to canonical workspace (1)
        assert rows["agt_1"] == 1
        assert rows["agt_2"] == 1
    finally:
        os.unlink(db_path)


def test_migration_cleans_cross_workspace_agent_members():
    """Cross-workspace AgentMember records from legacy auto-insert should be deleted."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_workspace_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        members = conn.execute("SELECT agent_id, admin_user_id FROM agent_members").fetchall()
        conn.close()

        # After migration, all remaining AgentMember should be within same workspace
        # (admin.workspace_id == agent.workspace_id)
        # Since all were consolidated to workspace 1, all remaining memberships are valid
        # But the logic should have deleted cross-workspace memberships before consolidation
        # Actually, with consolidation, all agents move to workspace 1, so cross-workspace check
        # happens BEFORE consolidation and would delete records where agent.workspace != admin.workspace
        # In our test: admin workspace_id gets backfilled to 1, agent agt_2 was in workspace 2
        # So the cross-workspace cleanup should have deleted (agt_2, admin_user_id=1)
        member_pairs = [(m["agent_id"], m["admin_user_id"]) for m in members]
        # The cross-workspace membership (agt_2, super_admin=1) should be deleted
        assert ("agt_2", 1) not in member_pairs
        # The valid memberships should remain
        assert ("agt_1", 1) in member_pairs  # super_admin → agt_1
        assert ("agt_1", 2) in member_pairs  # admin → agt_1
    finally:
        os.unlink(db_path)

# ---- knowledge base decoupling (issue #12) ---------------------------------

LEGACY_KB_DDL = """
CREATE TABLE knowledge_bases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'BAAI/bge-m3',
    embedding_base_url TEXT,
    vector_backend TEXT NOT NULL DEFAULT 'qdrant',
    qdrant_collection TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    chunk_size INTEGER NOT NULL DEFAULT 512,
    chunk_overlap INTEGER NOT NULL DEFAULT 64,
    status TEXT NOT NULL DEFAULT 'active',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE kb_documents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    kb_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    chunk_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

LEGACY_AGENTS_WITH_KB_DDL = """
CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'AI Agent',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    api_base TEXT DEFAULT 'https://api.openai.com/v1',
    kb_id TEXT,
    embedding_provider TEXT,
    embedding_api_base TEXT,
    embedding_model TEXT,
    embedding_batch_size INTEGER,
    jina_api_key TEXT,
    siliconflow_api_key TEXT,
    kb_setup_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

def _create_legacy_kb_db(db_path: str) -> str:
    """Legacy install: KB owns nothing, the bound agent owns the embedding config."""
    conn = sqlite3.connect(db_path)
    conn.executescript(LEGACY_AGENTS_WITH_KB_DDL)
    conn.executescript(LEGACY_KB_DDL)

    conn.execute("INSERT INTO workspaces (id, name, owner_email) VALUES (7, 'WS7', 'ws7@test.com')")
    conn.execute("INSERT INTO workspaces (id, name, owner_email) VALUES (9, 'WS9', 'ws9@test.com')")

    # A jina-bound agent in workspace 7.
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name, kb_id, embedding_provider, "
        "embedding_api_base, embedding_model, embedding_batch_size, jina_api_key) "
        "VALUES ('agt_jina', 7, 'Jina Agent', 'kb_jina', 'jina', "
        "'https://api.jina.ai/v1', 'jina-embeddings-v3', 8, 'enc:jina-ciphertext')"
    )
    # A siliconflow-bound agent in workspace 9, different model/width.
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name, kb_id, embedding_provider, "
        "embedding_api_base, embedding_model, embedding_batch_size, siliconflow_api_key) "
        "VALUES ('agt_sf', 9, 'Silicon Agent', 'kb_sf', 'siliconflow', "
        "'https://api.siliconflow.cn/v1', 'text-embedding-3-small', 16, 'enc:sf-ciphertext')"
    )
    # A bound agent in workspace 7 whose embedding columns are all empty.
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name, kb_id) "
        "VALUES ('agt_bare', 7, 'Bare Agent', 'kb_bare')"
    )
    # An unbound agent: must not influence any KB workspace.
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name) VALUES ('agt_unbound', 9, 'Unbound Agent')"
    )

    conn.execute(
        "INSERT INTO knowledge_bases (id, tenant_id, name, qdrant_collection) "
        "VALUES ('kb_jina', 'tenant-legacy', 'Jina KB', 'kb_jina_collection')"
    )
    conn.execute(
        "INSERT INTO knowledge_bases (id, tenant_id, name, qdrant_collection) "
        "VALUES ('kb_sf', 'tenant-legacy', 'Silicon KB', 'kb_sf_collection')"
    )
    conn.execute(
        "INSERT INTO knowledge_bases (id, tenant_id, name, qdrant_collection) "
        "VALUES ('kb_bare', 'tenant-legacy', 'Bare KB', 'kb_bare_collection')"
    )
    # Truly unbound KB: falls back to the canonical (MIN) workspace.
    conn.execute(
        "INSERT INTO knowledge_bases (id, tenant_id, name, qdrant_collection) "
        "VALUES ('kb_orphan', 'tenant-legacy', 'Orphan KB', 'kb_orphan_collection')"
    )

    conn.execute(
        "INSERT INTO kb_documents (id, tenant_id, kb_id, filename) "
        "VALUES ('doc_url', 'tenant-legacy', 'kb_jina', 'url_https_example_com')"
    )
    conn.execute(
        "INSERT INTO kb_documents (id, tenant_id, kb_id, filename) "
        "VALUES ('doc_upload', 'tenant-legacy', 'kb_jina', 'manual-upload.txt')"
    )

    conn.commit()
    conn.close()
    return db_path

def _kb_rows(db_path: str) -> dict[str, sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = {
        row["id"]: row
        for row in conn.execute("SELECT * FROM knowledge_bases").fetchall()
    }
    conn.close()
    return rows

def _index_names(db_path: str, table: str) -> list[str]:
    conn = sqlite3.connect(db_path)
    names = [row[1] for row in conn.execute(f"PRAGMA index_list('{table}')")]
    conn.close()
    return names

def test_migration_adds_kb_workspace_and_embedding_columns():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        kb_cols = {row[1] for row in conn.execute("PRAGMA table_info(knowledge_bases)")}
        doc_cols = {row[1] for row in conn.execute("PRAGMA table_info(kb_documents)")}
        conn.close()

        assert {"workspace_id", "embedding_provider", "embedding_api_key",
                "embedding_batch_size", "embedding_dimension"} <= kb_cols
        assert "source_agent_id" in doc_cols
        # Legacy columns stay.
        assert "tenant_id" in kb_cols
        assert "tenant_id" in doc_cols
        assert "ix_knowledge_bases_workspace_id" in _index_names(db_path, "knowledge_bases")
    finally:
        os.unlink(db_path)

def test_migration_backfills_kb_workspace_id_from_bound_agent():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        rows = _kb_rows(db_path)
        assert rows["kb_jina"]["workspace_id"] == 7  # from its bound agent
        assert rows["kb_sf"]["workspace_id"] == 9
        assert rows["kb_bare"]["workspace_id"] == 7
        # Unbound KB falls back to MIN(workspaces.id), not to an arbitrary agent.
        assert rows["kb_orphan"]["workspace_id"] == 7
        assert all(row["workspace_id"] is not None for row in rows.values())
    finally:
        os.unlink(db_path)

def test_migration_backfills_kb_embedding_config_from_bound_agent():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        rows = _kb_rows(db_path)

        assert rows["kb_jina"]["embedding_provider"] == "jina"
        assert rows["kb_jina"]["embedding_model"] == "jina-embeddings-v3"
        assert rows["kb_jina"]["embedding_base_url"] == "https://api.jina.ai/v1"
        assert rows["kb_jina"]["embedding_batch_size"] == 8
        assert rows["kb_jina"]["embedding_api_key"] == "enc:jina-ciphertext"

        assert rows["kb_sf"]["embedding_provider"] == "siliconflow"
        assert rows["kb_sf"]["embedding_model"] == "text-embedding-3-small"
        assert rows["kb_sf"]["embedding_api_key"] == "enc:sf-ciphertext"

        # Key copied verbatim (still encrypted), never decrypted in SQL.
        assert rows["kb_jina"]["embedding_api_key"].startswith("enc:")
        assert rows["kb_sf"]["embedding_api_key"].startswith("enc:")
    finally:
        os.unlink(db_path)

def test_migration_does_not_overwrite_existing_kb_embedding_config():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO knowledge_bases (id, name, embedding_model, qdrant_collection) "
            "VALUES ('kb_own', 'Own KB', 'custom-embedding-9000', 'kb_own_collection')"
        )
        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, kb_id, embedding_provider, "
            "embedding_model, jina_api_key) VALUES "
            "('agt_own', 7, 'Own Agent', 'kb_own', 'jina', 'jina-embeddings-v3', 'enc:other')"
        )
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")

        row = _kb_rows(db_path)["kb_own"]
        # An operator-chosen KB value is never replaced by the agent's.
        assert row["embedding_model"] == "custom-embedding-9000"
        assert row["embedding_dimension"] == 1024  # unknown model -> safe default
    finally:
        os.unlink(db_path)

def test_migration_backfills_kb_embedding_dimension_from_model():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO knowledge_bases (id, name, embedding_model, qdrant_collection) "
            "VALUES ('kb_large', 'Large KB', 'text-embedding-3-large', 'kb_large_c')"
        )
        conn.execute(
            "INSERT INTO knowledge_bases (id, name, embedding_model, qdrant_collection) "
            "VALUES ('kb_v2', 'V2 KB', 'jina-embeddings-v2-base-en', 'kb_v2_c')"
        )
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")

        rows = _kb_rows(db_path)
        assert rows["kb_jina"]["embedding_dimension"] == 1024  # jina-embeddings-v3
        assert rows["kb_sf"]["embedding_dimension"] == 1536  # text-embedding-3-small
        assert rows["kb_large"]["embedding_dimension"] == 3072
        assert rows["kb_v2"]["embedding_dimension"] == 768
        # Unknown model still gets the safe default rather than NULL.
        assert rows["kb_orphan"]["embedding_dimension"] == 1024
    finally:
        os.unlink(db_path)

def test_migration_backfills_source_agent_id_for_url_documents_only():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        docs = {
            row["id"]: row
            for row in conn.execute(
                "SELECT id, source_agent_id FROM kb_documents"
            ).fetchall()
        }
        conn.close()

        assert docs["doc_url"]["source_agent_id"] == "agt_jina"
        # Manual uploads stay NULL: their origin is not recoverable.
        assert docs["doc_upload"]["source_agent_id"] is None
    finally:
        os.unlink(db_path)

def test_migration_dedupes_duplicate_kb_bindings_keeping_the_oldest():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        conn = sqlite3.connect(db_path)
        # The bound agents are the oldest bindings, as on a real upgraded install.
        conn.execute("UPDATE agents SET created_at = '2023-01-01 00:00:00'")
        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, kb_id, created_at) VALUES "
            "('agt_newer', 7, 'Newer Agent', 'kb_jina', '2024-06-01 00:00:00')"
        )
        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, kb_id, created_at) VALUES "
            "('agt_mid', 7, 'Middle Agent', 'kb_sf', '2024-01-01 00:00:00')"
        )
        # Two bindings with an identical created_at: the rowid breaks the tie.
        conn.execute(
            "INSERT INTO knowledge_bases (id, name, qdrant_collection) "
            "VALUES ('kb_tie', 'Tie KB', 'kb_tie_collection')"
        )
        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, kb_id, created_at) VALUES "
            "('agt_tie_a', 7, 'Tie A', 'kb_tie', '2024-05-01 00:00:00')"
        )
        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, kb_id, created_at) VALUES "
            "('agt_tie_b', 7, 'Tie B', 'kb_tie', '2024-05-01 00:00:00')"
        )
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")

        conn = sqlite3.connect(db_path)
        bindings = {
            row[0]: row[1]
            for row in conn.execute("SELECT id, kb_id FROM agents").fetchall()
        }
        conn.close()

        assert bindings["agt_jina"] == "kb_jina"
        assert bindings["agt_newer"] is None
        assert bindings["agt_sf"] == "kb_sf"
        assert bindings["agt_mid"] is None
        # Ties break on rowid, i.e. insertion order: the earlier row keeps it.
        assert bindings["agt_tie_a"] == "kb_tie"
        assert bindings["agt_tie_b"] is None
        # Agents were never bound stay unbound.
        assert bindings["agt_unbound"] is None
    finally:
        os.unlink(db_path)

def test_migration_creates_the_partial_unique_index_on_agents_kb_id():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        assert "uq_agents_kb_id" in _index_names(db_path, "agents")

        # Many NULLs must be allowed…
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO agents (id, workspace_id, name) VALUES ('agt_n1', 7, 'N1')")
        conn.execute("INSERT INTO agents (id, workspace_id, name) VALUES ('agt_n2', 7, 'N2')")
        conn.commit()

        # …but a second binding of the same KB must be rejected by the index.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "UPDATE agents SET kb_id = 'kb_jina' WHERE id = 'agt_n1'"
            )
        conn.close()
    finally:
        os.unlink(db_path)

def test_kb_migration_block_is_idempotent():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_kb_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")
        first = _kb_rows(db_path)
        first_indexes = _index_names(db_path, "agents")

        run_sqlite_migrations(f"sqlite:///{db_path}")
        second = _kb_rows(db_path)
        second_indexes = _index_names(db_path, "agents")

        assert {k: dict(v) for k, v in first.items()} == {
            k: dict(v) for k, v in second.items()
        }
        assert sorted(first_indexes) == sorted(second_indexes)
    finally:
        os.unlink(db_path)

# ---- URL sources: agent scope -> KB scope (issues #15/#16) ------------------

LEGACY_URL_SOURCES_DDL = """
CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE knowledge_bases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,
    embedding_provider TEXT NOT NULL DEFAULT 'jina',
    embedding_model TEXT NOT NULL DEFAULT 'BAAI/bge-m3',
    embedding_base_url TEXT,
    vector_backend TEXT NOT NULL DEFAULT 'qdrant',
    qdrant_collection TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    chunk_size INTEGER NOT NULL DEFAULT 512,
    chunk_overlap INTEGER NOT NULL DEFAULT 64,
    status TEXT NOT NULL DEFAULT 'active',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'AI Agent',
    agent_type VARCHAR(50) NOT NULL DEFAULT 'website_support',
    channel_mode VARCHAR(50) NOT NULL DEFAULT 'web_widget',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    api_base TEXT DEFAULT 'https://api.openai.com/v1',
    kb_id TEXT,
    embedding_provider TEXT,
    embedding_api_base TEXT,
    embedding_model TEXT,
    embedding_batch_size INTEGER,
    jina_api_key TEXT,
    siliconflow_api_key TEXT,
    kb_setup_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_agents_agent_type ON agents(agent_type);
CREATE TABLE url_sources (
    id INTEGER PRIMARY KEY,
    agent_id VARCHAR(50) NOT NULL REFERENCES agents(id),
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
    updated_at DATETIME,
    CONSTRAINT uq_agent_normalized_url UNIQUE (agent_id, normalized_url)
);
CREATE INDEX ix_url_sources_agent_id ON url_sources(agent_id);
CREATE INDEX ix_url_sources_agent_status ON url_sources(agent_id, status);
"""

def _create_legacy_url_source_db(db_path: str) -> str:
    """Legacy install: url_sources hang off agents, one agent is bound to a KB."""
    conn = sqlite3.connect(db_path)
    conn.executescript(LEGACY_URL_SOURCES_DDL)
    conn.execute(
        "INSERT INTO workspaces (id, name, owner_email) VALUES (3, 'WS3', 'ws3@test.com')"
    )
    conn.execute(
        "INSERT INTO knowledge_bases (id, name, qdrant_collection) "
        "VALUES ('kb_bound', 'Bound KB', 'kb_bound_collection')"
    )
    # Agent bound to a KB: its URL sources are recoverable.
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name, kb_id, created_at) VALUES "
        "('agt_bound', 3, 'Bound Agent', 'kb_bound', '2023-01-01 00:00:00')"
    )
    # Agent without a KB: its URL sources cannot be indexed anywhere.
    conn.execute(
        "INSERT INTO agents (id, workspace_id, name, created_at) VALUES "
        "('agt_unbound', 3, 'Unbound Agent', '2023-01-02 00:00:00')"
    )
    conn.execute(
        "INSERT INTO url_sources "
        "(id, agent_id, url, normalized_url, status, content_hash, is_indexed) "
        "VALUES (1, 'agt_bound', 'https://example.com/a', 'https://example.com/a', "
        "'success', 'hash-a', 1)"
    )
    conn.execute(
        "INSERT INTO url_sources "
        "(id, agent_id, url, normalized_url, status, is_indexed) "
        "VALUES (2, 'agt_unbound', 'https://example.com/orphan', "
        "'https://example.com/orphan', 'pending', 0)"
    )
    conn.commit()
    conn.close()
    return db_path

def _url_source_rows(db_path: str) -> dict[int, sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = {
        row["id"]: row
        for row in conn.execute("SELECT * FROM url_sources ORDER BY id").fetchall()
    }
    conn.close()
    return rows

def _table_columns(db_path: str, table: str) -> set[str]:
    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    conn.close()
    return columns

def test_migration_rebuilds_url_sources_to_kb_scope():
    """Legacy agent-scoped rows are re-pointed at the agent's KB; orphans dropped."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_url_source_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        columns = _table_columns(db_path, "url_sources")
        assert "kb_id" in columns
        assert "agent_id" not in columns

        rows = _url_source_rows(db_path)
        # Only the row whose agent is bound to a KB survives.
        assert sorted(rows) == [1]
        surviving = rows[1]
        assert surviving["kb_id"] == "kb_bound"
        assert surviving["url"] == "https://example.com/a"
        assert surviving["normalized_url"] == "https://example.com/a"
        assert surviving["status"] == "success"
        assert surviving["content_hash"] == "hash-a"
        assert surviving["is_indexed"] == 1
        # The orphan (agent without a KB) is gone, not re-pointed at anything.
        assert "https://example.com/orphan" not in {
            row["url"] for row in rows.values()
        }
    finally:
        os.unlink(db_path)

def test_migration_url_sources_unique_is_per_kb():
    """uq_kb_normalized_url is enforced on (kb_id, normalized_url), per KB."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_url_source_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        index_names = _index_names(db_path, "url_sources")
        assert "uq_kb_normalized_url" in index_names
        assert "ix_url_sources_kb_status" in index_names
        assert "ix_url_sources_agent_status" not in index_names

        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO knowledge_bases (id, name, qdrant_collection) "
            "VALUES ('kb_other', 'Other KB', 'kb_other_collection')"
        )
        conn.commit()
        # Same URL under a different KB is fine.
        conn.execute(
            "INSERT INTO url_sources (kb_id, url, normalized_url, status) "
            "VALUES ('kb_other', 'https://example.com/a', 'https://example.com/a', 'pending')"
        )
        conn.commit()
        # Same URL under the same KB is a duplicate.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO url_sources (kb_id, url, normalized_url, status) "
                "VALUES ('kb_bound', 'https://example.com/a', "
                "'https://example.com/a', 'pending')"
            )
        conn.close()
    finally:
        os.unlink(db_path)

def test_migration_drops_retired_agent_columns():
    """agents.agent_type / channel_mode are gone after the migration (issue #20)."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_url_source_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")

        columns = _table_columns(db_path, "agents")
        assert "agent_type" not in columns
        assert "channel_mode" not in columns
        # Nothing else was lost: the row and the KB binding survive.
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, kb_id, name FROM agents WHERE id = 'agt_bound'"
        ).fetchone()
        conn.close()
        assert row["kb_id"] == "kb_bound"
        assert row["name"] == "Bound Agent"
        assert "ix_agents_agent_type" not in _index_names(db_path, "agents")
    finally:
        os.unlink(db_path)

def test_url_sources_migration_is_idempotent():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_url_source_db(db_path)
        run_sqlite_migrations(f"sqlite:///{db_path}")
        first_rows = {k: dict(v) for k, v in _url_source_rows(db_path).items()}
        first_indexes = sorted(_index_names(db_path, "url_sources"))

        # A second startup must not rebuild, drop or duplicate anything.
        run_sqlite_migrations(f"sqlite:///{db_path}")
        second_rows = {k: dict(v) for k, v in _url_source_rows(db_path).items()}
        second_indexes = sorted(_index_names(db_path, "url_sources"))

        assert first_rows == second_rows
        assert first_indexes == second_indexes
        assert sorted(second_rows) == [1]
    finally:
        os.unlink(db_path)

def test_url_source_and_agent_model_contract_matches_migration():
    """models.py declares the shape the migration produces (guards drift)."""
    from sqlalchemy import UniqueConstraint, inspect

    from models import Agent, KnowledgeBase, URLSource

    url_table = URLSource.__table__
    assert "kb_id" in url_table.columns
    assert "agent_id" not in url_table.columns
    assert url_table.columns["kb_id"].nullable is False
    assert {fk.target_fullname for fk in url_table.columns["kb_id"].foreign_keys} == {
        "knowledge_bases.id"
    }

    unique_names = {
        constraint.name: [column.name for column in constraint.columns]
        for constraint in url_table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert unique_names.get("uq_kb_normalized_url") == ["kb_id", "normalized_url"]
    assert "uq_agent_normalized_url" not in unique_names

    index_names = {
        index.name: [column.name for column in index.columns]
        for index in url_table.indexes
    }
    assert index_names.get("ix_url_sources_kb_status") == ["kb_id", "status"]
    assert "ix_url_sources_agent_status" not in index_names

    assert "agent_type" not in Agent.__table__.columns
    assert "channel_mode" not in Agent.__table__.columns
    agent_relationships = inspect(Agent).relationships
    kb_relationships = inspect(KnowledgeBase).relationships
    assert "url_sources" not in agent_relationships
    assert "url_sources" in kb_relationships

def test_migration_completes_a_half_migrated_url_sources_table():
    """A table that already has kb_id but still has agent_id is still rebuilt."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        _create_legacy_url_source_db(db_path)
        conn = sqlite3.connect(db_path)
        conn.execute("ALTER TABLE url_sources ADD COLUMN kb_id TEXT")
        conn.execute("UPDATE url_sources SET kb_id = 'kb_bound'")
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")

        columns = _table_columns(db_path, "url_sources")
        assert "kb_id" in columns
        assert "agent_id" not in columns
        rows = _url_source_rows(db_path)
        # Rows that were already re-pointed keep their kb_id instead of being
        # dropped because their agent happens to be unbound.
        assert {row_id: row["kb_id"] for row_id, row in rows.items()} == {
            1: "kb_bound",
            2: "kb_bound",
        }
    finally:
        os.unlink(db_path)

# ---- workspaces.example_seed_state (round 4, R1) ----------------------------

OLD_WORKSPACES_DDL = """
CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Default Workspace',
    owner_email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

def test_migration_defaults_example_seed_state_to_pending():
    """An existing install must be retried, not permanently suppressed."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        conn = sqlite3.connect(db_path)
        conn.executescript(OLD_WORKSPACES_DDL)
        conn.execute(
            "INSERT INTO workspaces (name, owner_email) VALUES ('W', 'w@example.com')"
        )
        conn.commit()
        conn.close()

        run_sqlite_migrations(f"sqlite:///{db_path}")
        run_sqlite_migrations(f"sqlite:///{db_path}")  # idempotent

        conn = sqlite3.connect(db_path)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(workspaces)")}
        rows = conn.execute("SELECT example_seed_state FROM workspaces").fetchall()
        conn.close()

        assert "example_seed_state" in columns
        assert rows == [("pending",)], rows
    finally:
        os.unlink(db_path)
