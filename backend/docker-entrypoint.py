#!/usr/bin/env python3
"""
Docker entrypoint script that ensures proper permissions and switches to non-root user.
"""
import os
import pwd
import secrets
import sqlite3
import stat
import subprocess
import sys
from pathlib import Path

INSECURE_SECRET_VALUES = {
    "",
    "change-me-in-production",
    "your-secret-key-change-in-production",
    "dev-secret-key",
}
DEFAULT_SECRET_KEY_FILE = "/app/data/.secret_key"
DEFAULT_ENCRYPTION_KEY_FILE = "/app/data/.encryption_key"
DEFAULT_ALLOWED_METHODS = "GET,POST,PUT,DELETE,OPTIONS"
DEFAULT_ALLOWED_HEADERS = "Content-Type,Authorization,X-Requested-With,Accept"


def _is_missing_or_insecure_secret(value: str) -> bool:
    normalized = (value or "").strip()
    return not normalized or normalized in INSECURE_SECRET_VALUES


def ensure_data_directory():
    """Ensure data directory exists with correct permissions."""
    data_dir = "/app/data"

    if not os.path.exists(data_dir):
        print(f"Creating data directory: {data_dir}")
        os.makedirs(data_dir, exist_ok=True)

    try:
        user_info = pwd.getpwnam("basjoo")
        uid = user_info.pw_uid
        gid = user_info.pw_gid

        print(f"Fixing permissions for {data_dir}")
        os.chown(data_dir, uid, gid)
        os.chmod(data_dir, 0o755)

        for root, dirs, files in os.walk(data_dir):
            os.chown(root, uid, gid)
            os.chmod(root, 0o755)

            for dirname in dirs:
                path = os.path.join(root, dirname)
                os.chown(path, uid, gid)
                os.chmod(path, 0o755)

            for filename in files:
                path = os.path.join(root, filename)
                os.chown(path, uid, gid)
    except KeyError:
        print("Warning: basjoo user not found, running as current user")
        return None, None

    return uid, gid


def apply_lenient_defaults():
    """Apply permissive defaults so first-run deployments succeed without a populated .env."""
    secret_key_file = os.environ.get("SECRET_KEY_FILE", "").strip() or DEFAULT_SECRET_KEY_FILE
    encryption_key_file = os.environ.get("ENCRYPTION_KEY_FILE", "").strip() or DEFAULT_ENCRYPTION_KEY_FILE
    os.environ["SECRET_KEY_FILE"] = secret_key_file
    os.environ["ENCRYPTION_KEY_FILE"] = encryption_key_file

    if not os.environ.get("ALLOWED_ORIGINS", "").strip():
        os.environ["ALLOWED_ORIGINS"] = "*"
        print("ALLOWED_ORIGINS not set; defaulting to '*' for zero-config deployment")

    if not os.environ.get("ALLOWED_METHODS", "").strip():
        os.environ["ALLOWED_METHODS"] = DEFAULT_ALLOWED_METHODS

    if not os.environ.get("ALLOWED_HEADERS", "").strip():
        os.environ["ALLOWED_HEADERS"] = DEFAULT_ALLOWED_HEADERS



def _load_secret_from_file(secret_key_file: str):
    try:
        path = Path(secret_key_file)
        if not path.exists():
            return None

        secret_key = path.read_text(encoding="utf-8").strip()
        return secret_key or None
    except Exception as exc:
        print(f"Warning: failed to read SECRET_KEY from {secret_key_file}: {exc}")
        return None



def _generate_and_save_secret(secret_key_file: str) -> str:
    secret_key = secrets.token_urlsafe(32)
    path = Path(secret_key_file)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secret_key, encoding="utf-8")
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        print(f"Generated persistent SECRET_KEY file at {secret_key_file}")
    except Exception as exc:
        print(
            f"Warning: failed to persist generated SECRET_KEY to {secret_key_file}: {exc}. "
            "Using an in-memory fallback secret for this container."
        )

    return secret_key



def ensure_secret_key():
    """Ensure SECRET_KEY is always available, preferring a persistent file fallback."""
    secret_key_file = os.environ.get("SECRET_KEY_FILE", DEFAULT_SECRET_KEY_FILE)
    secret_key = os.environ.get("SECRET_KEY", "")

    if not _is_missing_or_insecure_secret(secret_key):
        print("Using SECRET_KEY from environment")
        return secret_key

    file_secret = _load_secret_from_file(secret_key_file)
    if file_secret:
        os.environ["SECRET_KEY"] = file_secret
        print(f"Loaded SECRET_KEY from {secret_key_file}")
        return file_secret

    generated_secret = _generate_and_save_secret(secret_key_file)
    os.environ["SECRET_KEY"] = generated_secret
    print("SECRET_KEY not configured; generated a fallback secret automatically")
    return generated_secret



def check_encryption_key():
    """Check encryption key file status."""
    key_file = os.environ.get("ENCRYPTION_KEY_FILE", DEFAULT_ENCRYPTION_KEY_FILE)

    if os.path.exists(key_file):
        print(f"Encryption key file exists: {key_file}")
        stat_info = os.stat(key_file)
        print(f"  Permissions: {oct(stat_info.st_mode)[-3:]}")
        print(f"  Owner: {stat_info.st_uid}")
    else:
        print(f"Encryption key file will be auto-generated at: {key_file}")



def validate_secret_key():
    """Ensure SECRET_KEY is resolved even when production validation is enabled."""
    require_secret_key = os.environ.get("REQUIRE_SECRET_KEY", "").lower() in {"1", "true", "yes", "on"}
    secret_key = os.environ.get("SECRET_KEY", "")

    if _is_missing_or_insecure_secret(secret_key):
        print("Error: SECRET_KEY could not be resolved during startup")
        sys.exit(1)

    if require_secret_key:
        print("REQUIRE_SECRET_KEY is enabled and a valid SECRET_KEY is available")



def migrate_sqlite_schema():
    """Apply lightweight SQLite migrations for newly added columns and indexes."""
    database_url = os.environ.get("DATABASE_URL", "")

    if not database_url.startswith("sqlite:///"):
        print("Skipping SQLite migration: non-SQLite DATABASE_URL")
        return

    sqlite_path = database_url[len("sqlite:///"):].split("?", 1)[0]
    if sqlite_path.startswith("/"):
        db_path = sqlite_path
    else:
        db_path = os.path.abspath(sqlite_path)
    if not os.path.exists(db_path):
        print(f"Skipping SQLite migration: database file not found at {db_path}")
        return

    migrations = {
        "chat_sessions": [
            ("visitor_ip", "TEXT"),
            ("visitor_user_agent", "TEXT"),
            ("visitor_country", "TEXT"),
            ("visitor_region", "TEXT"),
            ("visitor_city", "TEXT"),
        ],
        "chat_messages": [
            ("sender_type", "TEXT"),
            ("sender_id", "TEXT"),
        ],
        "agents": [
            (
                "restricted_reply",
                "TEXT",
            ),
            (
                "last_error_code",
                "VARCHAR(50)",
            ),
            (
                "last_error_message",
                "TEXT",
            ),
            (
                "last_error_at",
                "DATETIME",
            ),
            (
                "allowed_widget_origins",
                "TEXT",
            ),
        ],
    }

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        for table_name, columns in migrations.items():
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table_name,),
            )
            table_exists = cursor.fetchone() is not None
            if not table_exists:
                print(f"Skipping migration for missing table: {table_name}")
                continue

            cursor.execute(f"PRAGMA table_info({table_name})")
            existing_columns = {row[1] for row in cursor.fetchall()}

            for column_name, column_type in columns:
                if column_name in existing_columns:
                    continue

                alter_sql = (
                    f"ALTER TABLE {table_name} "
                    f"ADD COLUMN {column_name} {column_type}"
                )
                print(f"Applying migration: {alter_sql}")
                cursor.execute(alter_sql)

        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_sessions'"
        )
        chat_sessions_exists = cursor.fetchone() is not None
        if chat_sessions_exists:
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='uq_chat_sessions_active_session'"
            )
            unique_session_index_exists = cursor.fetchone() is not None
            if not unique_session_index_exists:
                print("Ensuring unique active session rows per (agent_id, session_id)...")
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
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_active_session ON chat_sessions (agent_id, session_id) WHERE status != 'closed'"
                )
        else:
            print("Skipping unique active session migration: chat_sessions table not found")

        conn.commit()
        print("SQLite migration check completed")
    except Exception as e:
        print(f"SQLite migration failed: {e}")
        sys.exit(1)
    finally:
        try:
            conn.close()
        except Exception:
            pass



def drop_privileges(uid, gid):
    """Drop privileges to specified user."""
    if uid is None or gid is None:
        return

    os.setgid(gid)
    os.setuid(uid)

    home_dir = "/app"
    os.environ["HOME"] = home_dir
    os.chdir(home_dir)

    new_uid = os.getuid()
    new_gid = os.getgid()
    print(f"Dropped privileges to UID={new_uid}, GID={new_gid}, HOME={home_dir}")



def main():
    """Main entrypoint function."""
    if os.getuid() == 0:
        uid, gid = ensure_data_directory()

        if uid is not None:
            print("Switching to basjoo user...")
            drop_privileges(uid, gid)
    else:
        print(f"Running as UID={os.getuid()}, skipping privilege drop")

    apply_lenient_defaults()
    ensure_secret_key()
    validate_secret_key()
    check_encryption_key()

    migrate_sqlite_schema()

    cmd = sys.argv[1:]
    if not cmd:
        cmd = ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

    print(f"Starting application: {' '.join(cmd)}")
    sys.exit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
