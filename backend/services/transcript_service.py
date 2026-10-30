"""Transcript email (#41): plain text over SMTP, sent exactly once per session.

Three rules shape this module.

* **`aiosmtplib` is not a dependency** (see `backend/requirements.txt`), and the
  spec forbids adding one on a request path, so the send is stdlib `smtplib` in
  a worker thread via `anyio.to_thread.run_sync`.
* **Unset SMTP is a configuration state, not a failure.** `SmtpNotConfigured`
  is raised and the route turns it into a 503 whose detail is the localized
  "SMTP 未配置" / "SMTP is not configured" — never a 500 and never a traceback.
* **Exactly once** is enforced by the caller's conditional `UPDATE` on
  `transcript_sent_at` (`services.lead_service.touch_transcript_sent`); this
  module only renders and sends. It never touches the session row, so the guard
  cannot be bypassed by calling it twice.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from typing import Iterable, Optional

import anyio

from config import settings

logger = logging.getLogger(__name__)

# The exact English msgid the backend catalog translates; the route localizes it
# with `i18n.core._`. Kept as one constant so the test and the catalog agree.
SMTP_NOT_CONFIGURED_MESSAGE = "SMTP is not configured"
SMTP_SEND_FAILED_MESSAGE = "Could not send the transcript email"

SMTP_TIMEOUT_SECONDS = 20

# How many turns the plain-text body carries. A transcript is a record of the
# conversation, not a data export: the same 10-turn window the model sees keeps
# the message a size every mail server accepts.
TRANSCRIPT_MAX_MESSAGES = 500


class SmtpNotConfigured(RuntimeError):
    """SMTP_HOST/SMTP_FROM are unset; the route answers 503."""


class TranscriptSendFailed(RuntimeError):
    """SMTP answered with an error. The claim is released so a retry can work."""


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    user: str
    password: str
    sender: str
    use_tls: bool

    @property
    def configured(self) -> bool:
        return bool(self.host and self.sender)


def load_smtp_settings() -> SmtpSettings:
    """Read SMTP_* from the environment exactly once per call.

    Not cached: an operator who sets the variables and restarts does not have to
    also clear a process-level cache, and the values are cheap to read.
    """
    port_raw = (getattr(settings, "smtp_port", "") or "").strip()
    try:
        port = int(port_raw) if port_raw else 587
    except ValueError:
        logger.warning("SMTP_PORT %r is not a number; using 587", port_raw)
        port = 587

    use_tls_raw = str(getattr(settings, "smtp_use_tls", "true")).strip().lower()
    return SmtpSettings(
        host=(getattr(settings, "smtp_host", "") or "").strip(),
        port=port,
        user=(getattr(settings, "smtp_user", "") or "").strip(),
        password=getattr(settings, "smtp_password", "") or "",
        sender=(getattr(settings, "smtp_from", "") or "").strip()
        or (getattr(settings, "smtp_user", "") or "").strip(),
        use_tls=use_tls_raw not in ("0", "false", "no", "off", ""),
    )


def smtp_is_configured() -> bool:
    return load_smtp_settings().configured


def render_transcript(
    *,
    agent_name: Optional[str],
    session_public_id: str,
    messages: Iterable,
    created_at: Optional[datetime] = None,
    contact_name: Optional[str] = None,
) -> str:
    """The plain-text body: a header block, then `role: content` lines.

    Roles are spelled out rather than symbolized so the mail is readable in a
    terminal and in every client; a human reply is marked as such because the
    transcript's whole point is who said what.
    """
    lines: list[str] = []
    title = agent_name.strip() if isinstance(agent_name, str) and agent_name.strip() else "Basjoo"
    lines.append(f"{title} — conversation transcript")
    lines.append(f"Session: {session_public_id}")
    if created_at is not None:
        lines.append(f"Started: {created_at.isoformat()}")
    if contact_name:
        lines.append(f"Visitor: {contact_name}")
    lines.append("")
    lines.append("-" * 60)
    lines.append("")

    count = 0
    for message in messages:
        if count >= TRANSCRIPT_MAX_MESSAGES:
            break
        role = getattr(message, "role", None) or "user"
        content = getattr(message, "content", "") or ""
        if role == "assistant":
            if getattr(message, "sender_type", None) == "human":
                label = "Operator"
            else:
                label = title
        elif role == "user":
            label = contact_name or "Visitor"
        else:
            label = "System"
        stamp = getattr(message, "created_at", None)
        prefix = f"[{stamp.isoformat()}] " if stamp is not None else ""
        lines.append(f"{prefix}{label}: {content}")
        lines.append("")
        count += 1

    if count == 0:
        lines.append("(no messages)")
    return "\n".join(lines).rstrip() + "\n"


def build_email(
    smtp: SmtpSettings,
    *,
    recipient: str,
    subject: str,
    body: str,
) -> EmailMessage:
    email = EmailMessage()
    email["From"] = smtp.sender
    email["To"] = recipient
    email["Subject"] = subject
    email.set_content(body)
    return email


def _send_sync(smtp: SmtpSettings, email: EmailMessage) -> None:
    """Blocking SMTP conversation. Runs in a worker thread, never on the loop."""
    if smtp.use_tls:
        context = ssl.create_default_context()
        with smtplib.SMTP(smtp.host, smtp.port, timeout=SMTP_TIMEOUT_SECONDS) as client:
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
            if smtp.user:
                client.login(smtp.user, smtp.password)
            client.send_message(email)
        return

    with smtplib.SMTP(smtp.host, smtp.port, timeout=SMTP_TIMEOUT_SECONDS) as client:
        client.ehlo()
        if smtp.user:
            client.login(smtp.user, smtp.password)
        client.send_message(email)


async def send_transcript_email(
    *,
    recipient: Optional[str],
    subject: str,
    body: str,
) -> None:
    """Send one plain-text mail, or raise a typed error the route can map.

    Raises `SmtpNotConfigured` (503) when the environment has no SMTP host or
    sender, and `TranscriptSendFailed` (502) when the server rejects the send —
    a caller that already claimed the idempotency slot must release it in that
    case so a retry is possible.
    """
    if not recipient or not recipient.strip():
        raise TranscriptSendFailed("No recipient address for this session")

    smtp = load_smtp_settings()
    if not smtp.configured:
        raise SmtpNotConfigured(SMTP_NOT_CONFIGURED_MESSAGE)

    email = build_email(
        smtp,
        recipient=recipient.strip(),
        subject=subject,
        body=body,
    )

    try:
        await anyio.to_thread.run_sync(_send_sync, smtp, email)
    except Exception as error:  # smtplib raises a wide family of exceptions
        logger.warning(
            "Transcript email to %s failed via %s:%s — %s",
            recipient,
            smtp.host,
            smtp.port,
            error,
        )
        raise TranscriptSendFailed(str(error)) from error
