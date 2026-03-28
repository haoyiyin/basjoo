#!/usr/bin/env python3
"""Bootstrap a permissive project .env for zero-config deployments."""

from __future__ import annotations

import base64
import os
import re
import secrets
from pathlib import Path
from typing import Callable



def _detect_project_root() -> Path:
    candidates = [
        Path(os.environ.get("BASJOO_PROJECT_ROOT", "")).expanduser(),
        Path.cwd(),
        Path(__file__).resolve().parent,
        Path(__file__).resolve().parents[1],
    ]

    for candidate in candidates:
        if not str(candidate):
            continue
        if (candidate / ".env.example").exists() or (candidate / "docker-compose.yml").exists():
            return candidate

    return Path.cwd()


PROJECT_ROOT = _detect_project_root()
DEFAULT_ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_TEMPLATE_PATH = PROJECT_ROOT / ".env.example"

INSECURE_SECRET_VALUES = {
    "",
    "change-me-in-production",
    "your-secret-key-change-in-production",
    "dev-secret-key",
}

DEFAULT_VALUES = {
    "ALLOWED_ORIGINS": "*",
    "ALLOWED_METHODS": "GET,POST,PUT,DELETE,OPTIONS",
    "ALLOWED_HEADERS": "Content-Type,Authorization,X-Requested-With,Accept",
    "SECRET_KEY_FILE": "/app/data/.secret_key",
    "ENCRYPTION_KEY_FILE": "/app/data/.encryption_key",
}

FORCE_OVERRIDE_KEYS = {"ALLOWED_ORIGINS", "ALLOWED_HEADERS"}

GENERATED_VALUES: dict[str, Callable[[], str]] = {
    "SECRET_KEY": lambda: secrets.token_urlsafe(32),
    "ENCRYPTION_KEY": lambda: base64.urlsafe_b64encode(os.urandom(32)).decode(),
}


def _read_env_text(env_path: Path, template_path: Path) -> str:
    if env_path.exists():
        return env_path.read_text(encoding="utf-8")
    if template_path.exists():
        return template_path.read_text(encoding="utf-8")
    return ""


def _get_env_value(text: str, key: str) -> str | None:
    match = re.search(rf"(?m)^\s*{re.escape(key)}=(.*)$", text)
    if not match:
        return None
    return match.group(1).strip()


def _upsert_env_value(text: str, key: str, value: str) -> str:
    line = f"{key}={value}"
    pattern = re.compile(rf"(?m)^\s*{re.escape(key)}=.*$")
    if pattern.search(text):
        return pattern.sub(line, text, count=1)

    suffix = "" if not text or text.endswith("\n") else "\n"
    return f"{text}{suffix}{line}\n"


def _should_generate_secret(value: str | None) -> bool:
    normalized = (value or "").strip()
    return not normalized or normalized in INSECURE_SECRET_VALUES


def ensure_project_env_file(project_root: Path | None = None) -> Path:
    root = project_root or PROJECT_ROOT
    env_path = root / ".env"
    template_path = root / ".env.example"
    env_text = _read_env_text(env_path, template_path)

    for key, value in DEFAULT_VALUES.items():
        current_value = _get_env_value(env_text, key)
        if key in FORCE_OVERRIDE_KEYS or not (current_value or "").strip():
            env_text = _upsert_env_value(env_text, key, value)

    for key, generator in GENERATED_VALUES.items():
        current_value = _get_env_value(env_text, key)
        if _should_generate_secret(current_value):
            env_text = _upsert_env_value(env_text, key, generator())

    env_path.write_text(env_text, encoding="utf-8")
    return env_path


if __name__ == "__main__":
    path = ensure_project_env_file()
    print(f"Prepared {path}")
