"""Wave 1 schema surface for #70–#75 (#71 attachments, #74 macros, #75 closed_by).

Two contracts are pinned here, and nothing else:

1. **An existing SQLite file gains the new shape.** The suite's own
   ``init_db()`` only ever exercises the fresh-install path (``create_all``), so
   every assertion below runs ``run_sqlite_migrations`` against a *throwaway*
   file under ``tmp_path`` that was first built with ``create_all`` and then
   stripped of exactly the wave-1 additions. That is the honest upgrade path: a
   deployment upgrading in place must end up with the same columns and tables.
2. **The app still imports and mounts the two new routers.** Wave 1 left both
   route-less and pinned that fact; wave 2 filled them, so the assertion now
   guards the real route sets (with the mount still pinned through `main`).

Every test is named for the failure it catches, so the report's mutation proof
(comment out one migration call → this file reds) points at one assertion.
"""

import sqlite3

import pytest
from sqlalchemy import create_engine, inspect, text

import models  # noqa: F401  (registers every table on Base.metadata)
from database import Base
from models import Agent, ChatAttachment, ChatSession, ReplyMacro
from sqlite_migrations import run_sqlite_migrations

WAVE1_TABLES = ("chat_attachments", "reply_macros")

# Columns each new table must carry, per `models.py`. A migration that creates
# the table but drops one of these would still pass a "table exists" check, so
# the list is asserted explicitly.
CHAT_ATTACHMENT_COLUMNS = (
    "id",
    "session_id",
    "message_id",
    "kind",
    "filename",
    "mime",
    "size_bytes",
    "status",
    "text_content",
    "created_at",
)

REPLY_MACRO_COLUMNS = (
    "id",
    "workspace_id",
    "name",
    "body",
    "created_by",
    "created_at",
    "updated_at",
)

def _columns(db_path: str, table: str) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    finally:
        conn.close()

def _tables(db_path: str) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    finally:
        conn.close()

def _strip_wave1(db_path: str) -> None:
    """Turn the current full schema into a pre-wave-1 database."""
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    engine.dispose()

    conn = sqlite3.connect(db_path)
    try:
        for table in WAVE1_TABLES:
            conn.execute(f"DROP TABLE {table}")
        conn.execute("ALTER TABLE chat_sessions DROP COLUMN closed_by")
        conn.commit()
    finally:
        conn.close()

@pytest.fixture
def upgraded_db(tmp_path) -> str:
    """A temp sqlite file that is pre-wave-1, then migrated once."""
    db_path = str(tmp_path / "legacy.db")
    _strip_wave1(db_path)

    # Precondition: the fixture really is the pre-change schema. Without this a
    # broken `_strip_wave1` would make every assertion below vacuous.
    assert "chat_attachments" not in _tables(db_path)
    assert "reply_macros" not in _tables(db_path)
    assert "closed_by" not in _columns(db_path, "chat_sessions")

    run_sqlite_migrations(f"sqlite:///{db_path}")
    return db_path

def test_existing_sqlite_file_gains_chat_attachments_table(upgraded_db):
    assert "chat_attachments" in _tables(upgraded_db), (
        "run_sqlite_migrations must CREATE TABLE chat_attachments on an "
        "existing database (#71); create_all only covers fresh installs"
    )
    actual = _columns(upgraded_db, "chat_attachments")
    missing = [column for column in CHAT_ATTACHMENT_COLUMNS if column not in actual]
    assert not missing, f"chat_attachments missing columns after migration: {missing}"

def test_existing_sqlite_file_gains_reply_macros_table(upgraded_db):
    assert "reply_macros" in _tables(upgraded_db), (
        "run_sqlite_migrations must CREATE TABLE reply_macros on an existing "
        "database (#74)"
    )
    actual = _columns(upgraded_db, "reply_macros")
    missing = [column for column in REPLY_MACRO_COLUMNS if column not in actual]
    assert not missing, f"reply_macros missing columns after migration: {missing}"

def test_existing_sqlite_file_gains_chat_sessions_closed_by(upgraded_db):
    assert "closed_by" in _columns(upgraded_db, "chat_sessions"), (
        "run_sqlite_migrations must ALTER TABLE chat_sessions ADD COLUMN "
        "closed_by (#75); without it every visitor End-chat write raises"
    )

def test_migration_keeps_a_pre_existing_session_row(tmp_path):
    """The upgrade must not lose or reinterpret an existing row (#75 honesty)."""
    db_path = str(tmp_path / "legacy.db")
    _strip_wave1(db_path)

    # ORM insert for the agent so every NOT NULL default (system_prompt, model, …)
    # is filled by the model instead of this test.
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.begin() as conn:
            # Seed a pre-upgrade session BEFORE the migration runs, so the row
            # is the thing being upgraded, not something the upgrade created.
            conn.execute(
                text(
                    "INSERT INTO workspaces (id, name, owner_email) "
                    "VALUES (7, 'W', 'a@b.c')"
                )
            )
            conn.execute(
                Agent.__table__.insert().values(
                    id="agent-1", workspace_id=7, name="A", is_active=True
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
    finally:
        engine.dispose()

    run_sqlite_migrations(f"sqlite:///{db_path}")

    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT closed_by, status FROM chat_sessions WHERE id = 'sess_old'"
        ).fetchone()
        assert row == (None, "active"), (
            "a pre-existing session must keep status='active' and read as "
            "NOT visitor-closed (closed_by NULL) after the upgrade"
        )
    finally:
        conn.close()

def test_migration_is_idempotent_for_wave1_tables(tmp_path):
    db_path = str(tmp_path / "legacy.db")
    _strip_wave1(db_path)
    url = f"sqlite:///{db_path}"

    run_sqlite_migrations(url)
    first = {table: _columns(db_path, table) for table in WAVE1_TABLES}
    first_closed_by = _columns(db_path, "chat_sessions")

    # A second startup (the real deployment restarts) must neither raise on a
    # duplicate table/column nor change the shape.
    run_sqlite_migrations(url)

    assert {table: _columns(db_path, table) for table in WAVE1_TABLES} == first
    assert _columns(db_path, "chat_sessions") == first_closed_by

def test_fresh_sqlite_file_is_left_to_create_all(tmp_path):
    """No file yet -> migration is a no-op; `create_all` owns a fresh install."""
    missing = str(tmp_path / "nope.db")
    run_sqlite_migrations(f"sqlite:///{missing}")
    assert not (tmp_path / "nope.db").exists()

def test_models_registered_with_the_new_tables_and_column():
    """The ORM surface wave 2 builds on: table names, NOT NULL spans, caps."""
    assert ChatAttachment.__tablename__ == "chat_attachments"
    assert ReplyMacro.__tablename__ == "reply_macros"

    attachment_columns = {
        column.name: column for column in inspect(ChatAttachment).columns
    }
    assert set(CHAT_ATTACHMENT_COLUMNS) == set(attachment_columns)
    # Optional by design: an upload exists before its turn does (message_id), an
    # image is stored without OCR (text_content), and mime is provider-supplied.
    for nullable in ("message_id", "mime", "text_content"):
        assert attachment_columns[nullable].nullable is True
    assert attachment_columns["session_id"].nullable is False
    assert attachment_columns["size_bytes"].nullable is False
    assert attachment_columns["status"].default.arg == "uploaded"
    # The FK points at the session row the visitor owns.
    assert "chat_sessions.id" in str(attachment_columns["session_id"].foreign_keys)

    macro_columns = {column.name: column for column in inspect(ReplyMacro).columns}
    assert set(REPLY_MACRO_COLUMNS) == set(macro_columns)
    assert macro_columns["workspace_id"].nullable is False
    assert macro_columns["name"].type.length == 200
    # `created_by` is nullable: a macro outlives the admin who wrote it.
    assert macro_columns["created_by"].nullable is True

    session_columns = {column.name: column for column in inspect(ChatSession).columns}
    assert "closed_by" in session_columns
    assert session_columns["closed_by"].nullable is True
    assert session_columns["closed_by"].type.length == 20

def test_schemas_carry_the_wave1_contract_for_wave2():
    """The frozen surface wave 2 builds on: attachment cap and macro caps.

    Lane A reads `ChatRequest.attachment_ids`; lane E reads the macro requests.
    A wrong cap here would only surface as a wave-2 test failure, so it is
    pinned now.
    """
    from pydantic import ValidationError

    # Import order matters: `api.v1.schemas` imports `services.url_safety`, and a
    # bare `import services` then imports `file_service`, which imports the
    # schemas back. Importing the app first loads `services` to completion, so
    # the cycle resolves — this is pre-existing (`services/__init__.py`) and not
    # something this lane changes.
    from main import app  # noqa: F401

    from api.v1.schemas import (
        ATTACHMENT_MAX_FILES,
        MACRO_BODY_MAX_LENGTH,
        MACRO_NAME_MAX_LENGTH,
        ChatRequest,
        MacroCreateRequest,
        MacroUpdateRequest,
        SessionEndResponse,
    )

    assert ATTACHMENT_MAX_FILES == 5
    assert MACRO_NAME_MAX_LENGTH == 200
    assert MACRO_BODY_MAX_LENGTH == 2500

    # A plain text turn stays byte-identical: no ids at all.
    assert ChatRequest(agent_id="a", message="hi").attachment_ids is None
    # Up to five ids are accepted, a sixth is rejected.
    assert ChatRequest(
        agent_id="a", message="hi", attachment_ids=[str(i) for i in range(5)]
    ).attachment_ids == ["0", "1", "2", "3", "4"]
    try:
        ChatRequest(
            agent_id="a", message="hi", attachment_ids=[str(i) for i in range(6)]
        )
    except ValidationError:
        pass
    else:  # pragma: no cover - the assertion below is the real failure signal
        raise AssertionError(
            "ChatRequest must reject more than ATTACHMENT_MAX_FILES attachment ids"
        )

    MacroCreateRequest(name="Reset password", body="Click …")
    for bad in (
        {"name": "x" * 201, "body": "ok"},
        {"name": "ok", "body": "x" * 2501},
    ):
        try:
            MacroCreateRequest(**bad)
        except ValidationError:
            continue
        raise AssertionError(f"MacroCreateRequest must reject {bad!r} (cap)")

    # `SessionEndResponse` is the #75 receipt: status + closed_by are the
    # contract the widget reads back.
    receipt = SessionEndResponse(session_id="sess_x")
    assert receipt.status == "closed"
    assert receipt.closed_by == "visitor"
    # A partial macro update with no fields is legal (a no-op PATCH).
    assert MacroUpdateRequest().model_dump(exclude_none=True) == {}

def test_app_imports_and_mounts_the_two_wave1_routers():
    """`from main import app` — plus the two stubs are reachable from it.

    Both routers are route-less in wave 1, so an empty `include_router` call
    adds nothing to `app.routes` and there is no runtime object to assert on.
    The mount is therefore pinned at the only place it exists at this stage:
    the aliases `main` imports and the two `include_router` calls it makes.
    """
    from pathlib import Path

    from fastapi import FastAPI

    import main as main_module
    from api.v1 import attachments_endpoints, macros_endpoints
    from main import app

    assert isinstance(app, FastAPI)
    assert attachments_endpoints.router.prefix == "/api/v1"
    assert attachments_endpoints.router.tags == ["attachments"]
    assert macros_endpoints.router.prefix == "/api/v1"
    assert macros_endpoints.router.tags == ["macros"]
    # Wave 1 pinned both routers as route-less. Wave 2 filled them, so the
    # assertion is inverted: the stubs must now carry their real routes.
    attachment_paths = {route.path for route in attachments_endpoints.router.routes}
    assert attachment_paths == {
        "/api/v1/chat/attachments",
        "/api/v1/chat/attachments/{attachment_id}",
    }, f"unexpected attachment routes: {attachment_paths}"
    macro_paths = {route.path for route in macros_endpoints.router.routes}
    assert macro_paths == {
        "/api/v1/admin/macros",
        "/api/v1/admin/macros/{macro_id}",
    }, f"unexpected macro routes: {macro_paths}"
    assert len(macros_endpoints.router.routes) == 4, (
        "#74 macros: GET/POST on the collection + PATCH/DELETE on the item"
    )

    # The aliases `main` imported are the modules above (not a stale copy).
    assert main_module.v1_attachments_endpoints is attachments_endpoints
    assert main_module.v1_macros_endpoints is macros_endpoints
    # …and both are actually mounted, near the sibling routers.
    source = Path(main_module.__file__).read_text(encoding="utf-8")
    assert "include_router(v1_attachments_endpoints.router" in source, (
        "main.py must mount v1_attachments_endpoints.router (#71)"
    )
    assert "include_router(v1_macros_endpoints.router" in source, (
        "main.py must mount v1_macros_endpoints.router (#74)"
    )
    # The OpenAPI document still generates with both routers included.
    assert app.openapi()["info"]["title"]
