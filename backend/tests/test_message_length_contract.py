"""The message-length cap is ONE number, and the UIs must not advertise another.

Measured before this test existed (dev stack, `/widget-demo`):

    browser sends 1200 chars -> POST /api/v1/chat/stream -> 422 string_too_long
    the widget advertised `maxlength="2000"` and its guard was `> 2000`
    the visitor saw only "Send failed, please try again later"

So the widget let the visitor type a message the schema rejects, and then
blamed the network. The console's Playground had no cap at all and diagnosed
that same 422 as "AI API call failed".

The fix is a single source of truth per client, checked against the schema
below rather than restated: `backend/api/v1/schemas.py` (`ChatRequest.message`),
`widget/src/BasjooWidget.tsx` (`MAX_MESSAGE_LENGTH`) and
`frontend-nextjs/src/lib/limits.ts` (`MAX_MESSAGE_LENGTH`). A literal `2000`
reappearing in either UI fails this test.
"""

import re
from pathlib import Path

import pytest

# Order matters: `services/__init__` pulls `file_service`, which imports
# `api.v1.schemas`. Entering the cycle through `services` lets the submodule
# import inside `api/v1/schemas.py` resolve; entering through `api.v1.schemas`
# first does not.
from services import file_service as _file_service  # noqa: F401

from api.v1.schemas import ChatRequest

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
WIDGET_SOURCE = REPO_ROOT / "widget" / "src" / "BasjooWidget.tsx"
CONSOLE_LIMITS = REPO_ROOT / "frontend-nextjs" / "src" / "lib" / "limits.ts"
PLAYGROUND = REPO_ROOT / "frontend-nextjs" / "src" / "views" / "Playground.tsx"
AUTH_CONTEXT = REPO_ROOT / "frontend-nextjs" / "src" / "context" / "AuthContext.tsx"


def _schema_max_length() -> int:
    """The number the request schema actually enforces, read off the model."""
    field = ChatRequest.model_fields["message"]
    for constraint in field.metadata:
        limit = getattr(constraint, "max_length", None)
        if limit is not None:
            return int(limit)
    raise AssertionError("ChatRequest.message has no max_length constraint")


def _reject_length(max_length: int) -> None:
    """One character past the cap must be a validation error, not accepted."""
    with pytest.raises(Exception):
        ChatRequest(agent_id="a", message="A" * (max_length + 1))
    ChatRequest(agent_id="a", message="A" * max_length)


def _declared(source: str) -> int:
    match = re.search(
        r"export const MAX_MESSAGE_LENGTH = (\d+)", source
    )
    assert match, "MAX_MESSAGE_LENGTH is not exported as a literal"
    return int(match.group(1))


# --------------------------------------------------------------- the contract


def test_schema_rejects_exactly_one_past_the_cap() -> None:
    """Pin the boundary itself so a silent schema change is a red test."""
    max_length = _schema_max_length()
    assert max_length == 1000, (
        f"ChatRequest.message.max_length is {max_length}; the widget and the "
        "console are pinned to it — update all three together"
    )
    _reject_length(max_length)


def test_widget_constant_matches_schema() -> None:
    max_length = _schema_max_length()
    assert _declared(WIDGET_SOURCE.read_text(encoding="utf-8")) == max_length


def test_console_constant_matches_schema() -> None:
    max_length = _schema_max_length()
    assert _declared(CONSOLE_LIMITS.read_text(encoding="utf-8")) == max_length


# ---------------------------------------------- no second literal in either UI


def test_widget_uses_the_constant_never_a_second_literal() -> None:
    """The three sites the bug lived in: attribute, guard and copy."""
    source = WIDGET_SOURCE.read_text(encoding="utf-8")

    assert 'maxlength="2000"' not in source
    assert "maxlength=\"${MAX_MESSAGE_LENGTH}\"" in source
    assert "message.length > 2000" not in source
    assert "message.length > MAX_MESSAGE_LENGTH" in source
    assert "max 2000 characters" not in source

    # The 422 branch: a length rejection reads `messageTooLong`, not `sendFailed`.
    assert "string_too_long" in source
    # A Pydantic 422 body carries `detail` as a LIST; stringifying it produced
    # "[object Object]" and lost the cause.
    assert "Array.isArray(raw)" in source


def test_console_playground_uses_the_constant_and_names_the_cause() -> None:
    source = PLAYGROUND.read_text(encoding="utf-8")

    assert "import { MAX_MESSAGE_LENGTH } from '../lib/limits'" in source
    assert "MAX_MESSAGE_LENGTH" in source
    # The cap is applied where every input path converges.
    assert "value.slice(0, MAX_MESSAGE_LENGTH)" in source
    # The 422 branch sits before the generic provider fallback.
    too_long_at = source.index("string_too_long")
    api_error_at = source.index("errors.aiApiError")
    assert too_long_at < api_error_at, (
        "the string_too_long branch must be reachable before the generic "
        "errors.aiApiError fallback"
    )


# ------------------------------------------------- the login locale (spec 2c)


def test_login_sends_the_spa_language_not_the_browser_header() -> None:
    """`/login` answered in Chinese with the SPA in EN.

    The backend derives the sentence from `Accept-Language`; fetch's default is
    the browser's, so the SPA toggle was ignored. Both auth calls must declare
    the SPA's own language.
    """
    source = AUTH_CONTEXT.read_text(encoding="utf-8")

    assert '"Accept-Language": i18n?.language' in source
    for endpoint in ("/api/admin/login", "/api/admin/register"):
        call_at = source.index(endpoint)
        window = source[call_at : call_at + 400]
        assert "localeHeaders()" in window, f"{endpoint} does not send the SPA locale"
