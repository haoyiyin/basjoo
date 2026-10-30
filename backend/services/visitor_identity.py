"""Signed visitor identity (#46) — HMAC-SHA256 over the visitor's email.

The problem this closes: `visitor_id` used to be a random string the browser
minted for itself, kept in `localStorage` and sent as a query parameter. It
identifies a transcript, but nothing ties it to a person — anyone who learns the
value (a referrer log, a support screenshot, a shared screen) can read the
transcript, and the same customer on a second device starts from nothing.

The fix is deliberately small: with `agent.identity_secret` configured, the only
accepted visitor identity is

    {email}:{hmac_sha256(secret, email)}          (lower-case hex)

computed by the **host application** after login and handed to the widget via
`window.Basjoo.identify({email, hash})`. The browser never holds the secret, so
a visitor cannot mint an identity for somebody else's email. Because the signed
value *is* the `visitor_id`, `chat_sessions.visitor_id` already keys the history:
the same email on a second device resolves to the same rows with no join table
and no accounts system.

What this module owns:

* the exact format above (one place, so the widget, the tests and the operator
  documentation cannot drift);
* constant-time verification — a timing oracle would defeat the point;
* nothing else. No FastAPI, no DB: the router decides what a failure means.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
from typing import Optional, Tuple

from core.encryption import decrypt_api_key

logger = logging.getLogger(__name__)

#: The machine-readable rejection code. `detail`/SSE `code` carry this exact
#: string, and the widget maps it to a readable sentence.
IDENTITY_MISMATCH = "identity_mismatch"

#: `hmac_sha256(secret, email)` rendered as lower-case hex.
DIGEST_HEX_LENGTH = 64

#: `email:digest` — the separator is the last colon, so an email containing one
#: (legal in the local part) still splits correctly.
SEPARATOR = ":"

#: RFC 5321 caps an address at 254 characters; 254 + 1 + 64 is the longest
#: identity that can exist. `chat_sessions.visitor_id` is sized from this.
MAX_EMAIL_LENGTH = 254
MAX_VISITOR_ID_LENGTH = MAX_EMAIL_LENGTH + 1 + DIGEST_HEX_LENGTH

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def normalize_email(email: str) -> str:
    """The canonical form the HMAC is computed over: trimmed, lower-cased.

    Case-folding here (and nowhere else) means a customer who signs in as
    `Ada@Example.com` on their phone and `ada@example.com` on a laptop is the
    same visitor. The host page and the widget both send the address as typed;
    the server is what makes it stable.
    """
    return (email or "").strip().lower()

def compute_identity_digest(secret: str, email: str) -> str:
    """`hmac_sha256(secret, normalized_email)` as lower-case hex."""
    return hmac.new(
        (secret or "").encode("utf-8"),
        normalize_email(email).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

def build_visitor_identity(secret: str, email: str) -> str:
    """The value a trusted server hands to the widget for this email."""
    normalized = normalize_email(email)
    return f"{normalized}{SEPARATOR}{compute_identity_digest(secret, normalized)}"

def split_visitor_identity(visitor_id: Optional[str]) -> Optional[Tuple[str, str]]:
    """`(email, digest)` for a shaped identity, else `None`.

    Shape only — this says nothing about whether the digest is correct. Kept
    separate from verification so a caller can ask "is this even the signed
    format?" without comparing anything.
    """
    if not isinstance(visitor_id, str):
        return None
    value = visitor_id.strip()
    if len(value) > MAX_VISITOR_ID_LENGTH:
        return None
    email, separator, digest = value.rpartition(SEPARATOR)
    if not separator or not email or not digest:
        return None
    if not _EMAIL_RE.match(email):
        return None
    if len(digest) != DIGEST_HEX_LENGTH:
        return None
    if any(character not in "0123456789abcdef" for character in digest.lower()):
        return None
    return email, digest.lower()

def _constant_time_equal(presented: str, expected: str) -> bool:
    """Compare two hex digests without leaking *what* differs.

    `hmac.compare_digest` on the raw strings still returns early when the
    lengths differ, which is a length oracle. Hashing both sides first makes the
    compared values fixed-size, so "right length, wrong value" and "wrong
    length" cost the same and answer the same.
    """
    return hmac.compare_digest(
        hashlib.sha256(presented.encode("utf-8")).digest(),
        hashlib.sha256(expected.encode("utf-8")).digest(),
    )

def agent_identity_secret(agent: object) -> Optional[str]:
    """The agent's decrypted HMAC secret, or `None` when unconfigured.

    Stored Fernet-encrypted (same helper as `api_key`). A stored-but-unreadable
    secret is treated as unconfigured **and logged**: silently accepting
    unsigned identities because decryption failed would be the security bug
    this whole module exists to prevent, but so would a 500 on every chat.
    """
    stored = getattr(agent, "identity_secret", None)
    if not stored:
        return None
    secret = decrypt_api_key(stored)
    if not secret:
        logger.error(
            "Agent %s has an identity_secret that could not be decrypted; "
            "signed visitor identities are unavailable until it is re-entered",
            getattr(agent, "id", "?"),
        )
        return None
    return secret

def identity_required(agent: object) -> bool:
    """Whether this agent accepts only signed identities."""
    return agent_identity_secret(agent) is not None

def verify_visitor_identity(agent: object, visitor_id: Optional[str]) -> bool:
    """Is `visitor_id` the correctly signed identity for this agent?

    An agent with no secret has nothing to verify — its anonymous path stays
    exactly as it was before #46, which is why this returns `True` for it.
    """
    secret = agent_identity_secret(agent)
    if secret is None:
        return True
    parts = split_visitor_identity(visitor_id)
    if parts is None:
        return False
    email, presented = parts
    return _constant_time_equal(presented, compute_identity_digest(secret, email))

def verified_identity_email(agent: object, visitor_id: Optional[str]) -> Optional[str]:
    """The email behind a *verified* identity, else `None`.

    Used where an email is needed rather than the opaque id (visitor deletion
    also sweeps leads captured without a session), so an unverified value can
    never widen the blast radius.

    "Verified" means *cryptographically* verified: an agent with no secret has
    nothing to check, and `verify_visitor_identity` answers `True` for it — but
    that `True` means "nothing to verify", not "this email is proven". Returning
    the address in that case would let a caller pass a shaped string
    (`someone@example.com:` + 64 hex) and sweep a stranger's leads, so the
    secret must actually be present.
    """
    secret = agent_identity_secret(agent)
    if secret is None:
        return None
    if not verify_visitor_identity(agent, visitor_id):
        return None
    parts = split_visitor_identity(visitor_id)
    return parts[0] if parts else None

def is_signed_identity(visitor_id: Optional[str]) -> bool:
    """Shape check only — for tests and for the admin surface's lead sweep."""
    return split_visitor_identity(visitor_id) is not None
