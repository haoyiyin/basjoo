"""Sampled spam screening (#44).

There was no spam check in the codebase before this file — `grep -rn 'spam'
backend/` only hits the `#44` comments on `ChatSession.ai_turn_count` and one
test that happens to use the word as a message body. So this module is the
check: a stdlib heuristic plus the sampling rule that decides *when* it runs.

Why sampling: screening every message costs a full pass (and, in a hosted
moderation setup, a network round trip) on the majority of turns that are
obviously fine. Chatbase screens messages 2, 4, 8, 16 — exponential per
session — which catches a harness-bot early (it starts flooding immediately)
while a 16-message session pays for at most 4 checks.

A hit pauses the session (contract C3) instead of answering: `should_ai_answer`
already refuses a `paused` row, so the visitor message is stored and the bot
stays silent. Pausing is per session — a *new* session for the same visitor
starts `active`.
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional

from services.session_state import should_ai_answer

logger = logging.getLogger(__name__)

# Contract C3: `paused` is the cost-control state, distinct from `closed`.
PAUSED_STATUS = "paused"

# The answered-turn indices that get screened. Exponential, capped — the issue
# names 2/4/8/16 and "and so on", so the ladder keeps doubling until it reaches
# a cap, after which a long session is never screened again (a 200-turn
# conversation is clearly not a bot).
SPAM_CHECK_BASE = 2
SPAM_CHECK_MAX_TURN = 64

_URL_RE = re.compile(r"https?://", re.IGNORECASE)
# A phone-shaped run: 11+ digits in a row (a CN mobile is 11).
_PHONE_RUN_RE = re.compile(r"\d{11,}")
# The same character twelve or more times in a row ("aaaaaaaaaaaaaa").
_REPEAT_RUN_RE = re.compile(r"(.)\1{11,}", re.DOTALL)

# Promotional / scam vocabulary. Latin and Chinese, lower-cased before compare.
_PROMO_TERMS = (
    "代刷",
    "刷单",
    "兼职日结",
    "博彩",
    "赌场",
    "开户入金",
    "免费领取",
    "点击链接",
    "加微信",
    "加微",
    "联系客服领取",
    "稳赚",
    "内幕消息",
    "加密货币投资",
    "usdt",
    "casino",
    "viagra",
    "cialis",
    "porn",
    "xxx",
    "free money",
    "click here",
    "earn per day",
    "work from home",
)

# A message this short can never carry enough signal to be judged.
_MIN_LENGTH = 8

def spam_check_indices(max_turn: int = SPAM_CHECK_MAX_TURN) -> List[int]:
    """The answered-turn indices that are screened, up to `max_turn` (inclusive).

    `spam_check_indices(16) == [2, 4, 8, 16]` — the ladder the issue names, and
    the bound a 16-message session is asserted against.
    """
    if max_turn < SPAM_CHECK_BASE:
        return []
    indices: List[int] = []
    turn = SPAM_CHECK_BASE
    while turn <= min(max_turn, SPAM_CHECK_MAX_TURN):
        indices.append(turn)
        turn *= 2
    return indices

def is_sampled_turn(turn_number: int) -> bool:
    """True when the `turn_number`-th answered turn is screened.

    `turn_number` is 1-based: the first answered turn of a session is 1, so it
    is never screened and a visitor's opening line is always answered.
    """
    if turn_number < SPAM_CHECK_BASE or turn_number > SPAM_CHECK_MAX_TURN:
        return False
    return turn_number in spam_check_indices(SPAM_CHECK_MAX_TURN)

def next_answered_turn(session) -> int:
    """The 1-based index of the turn about to be answered.

    `ai_turn_count` counts turns that were *already* answered, so the turn being
    prepared is one past it. Rows written before the column existed read as 0.
    """
    answered = getattr(session, "ai_turn_count", None) or 0
    return int(answered) + 1

def classify_message(text: str) -> Optional[str]:
    """Return why `text` looks like abuse, or ``None`` when it is fine.

    Deliberately conservative and dependency-free. A wrong positive pauses a
    real visitor's session, which is far worse than letting one junk message
    through, so every rule needs strong evidence on its own.
    """
    body = (text or "").strip()
    if len(body) < _MIN_LENGTH:
        return None

    if len(_URL_RE.findall(body)) >= 4:
        return "url_flood"

    if _REPEAT_RUN_RE.search(body):
        return "repeated_chars"

    collapsed = re.sub(r"\s+", "", body)
    if len(collapsed) >= 40 and len(set(collapsed)) <= 6:
        return "low_diversity"

    lowered = collapsed.lower()
    hits = sorted({term for term in _PROMO_TERMS if term in lowered})
    if not hits:
        return None
    if len(hits) >= 2:
        return "promo"
    if _URL_RE.search(body):
        return "promo_link"
    if _PHONE_RUN_RE.search(collapsed):
        return "promo_contact"
    return None

def is_spam(text: str) -> bool:
    """True when `text` should pause the session."""
    return classify_message(text) is not None

async def screen_answered_turn(
    session,
    message: str,
    db,
) -> Optional[str]:
    """Screen `message` when the turn is sampled, and pause the session on a hit.

    Returns the reason (`"url_flood"`, …) when the session was paused, else
    ``None``. The caller treats a paused session exactly like any other
    no-answer state: store the visitor message, answer nothing. The row is
    committed here so the pause survives a later failure in the request.
    """
    # A session the bot does not answer anyway (paused, taken over, resolved,
    # closed, or in human mode) is never screened: its `ai_turn_count` is frozen,
    # so it would sit on the same ladder rung and be re-screened on every
    # message for no reason.
    if not should_ai_answer(session):
        return None

    turn = next_answered_turn(session)
    if not is_sampled_turn(turn):
        return None

    reason = classify_message(message)
    if reason is None:
        return None

    logger.warning(
        "Spam screening paused session %s at answered turn %s (%s)",
        getattr(session, "session_id", None),
        turn,
        reason,
    )
    session.status = PAUSED_STATUS
    db.add(session)
    await db.commit()
    return reason
