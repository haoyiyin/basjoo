"""Answer-quality signals (#42): "was this question really answered?".

One module owns the whole rule so the chat pipeline, the admin queue and the
tests cannot drift apart:

* `is_real_question` — the ≥15-character gate. "hi" and "thanks" are chatter,
  never an unanswered question an operator should triage.
* `compute_confidence` — the best retrieval signal we actually had, 0..1, or
  `None` when nothing was retrieved. `None` means "no signal" and the UI shows
  an em dash; it is deliberately *not* `0.0`, which would read as "confident
  that nothing matched" and would rank above a genuinely weak 0.02 chunk.
* `looks_like_fallback` — the model replied with the configured restricted
  reply (or one of the built-in sentences), i.e. it did not really answer.

The built-in sentences live here, once. `api/v1/endpoints.py` imports them
instead of restating the literals at each fallback site.
"""

from __future__ import annotations

import math
import re
from typing import Iterable, Optional

#: A question needs this many non-whitespace characters to be triaged. Below
#: it the visitor sent a greeting, an emoji or a one-word "thanks".
UNANSWERED_MIN_QUESTION_CHARS = 15

#: Below this a message counts as low confidence for the session-list filter
#: and the transcript badge. Shared so the backend filter and the SPA badge
#: cannot disagree about which rows are "weak".
LOW_CONFIDENCE_THRESHOLD = 0.5

#: The agent has no `restricted_reply` configured and the provider failed.
DEFAULT_RESTRICTED_REPLY = "抱歉，当前服务繁忙，请稍后再试。"

#: The provider returned nothing at all.
DEFAULT_EMPTY_ANSWER_REPLY = "抱歉，我暂时无法回答这个问题，请换个方式提问。"

#: The per-minute rate limiter answered instead of the model.
DEFAULT_RATE_LIMIT_REPLY = "抱歉，当前服务受限，请稍后再试。"

#: Every built-in "the model did not answer" sentence. `looks_like_fallback`
#: compares against all of them, so a tenant that leaves `restricted_reply`
#: empty still gets its empty/busy replies flagged.
BUILTIN_FALLBACK_REPLIES: tuple[str, ...] = (
    DEFAULT_RESTRICTED_REPLY,
    DEFAULT_EMPTY_ANSWER_REPLY,
    DEFAULT_RATE_LIMIT_REPLY,
)

_WHITESPACE = re.compile(r"\s+")


def normalize_text(text: Optional[str]) -> str:
    """Trim, collapse every whitespace run to one space, lowercase."""
    if not text:
        return ""
    return _WHITESPACE.sub(" ", text).strip().lower()


def non_whitespace_length(text: Optional[str]) -> int:
    """Characters that are not whitespace — what the 15-character rule counts."""
    if not text:
        return 0
    return len("".join(text.split()))


def is_real_question(text: Optional[str]) -> bool:
    """>= 15 non-whitespace characters. 'hi' / 'thanks' are never logged."""
    return non_whitespace_length(text) >= UNANSWERED_MIN_QUESTION_CHARS


def _clean_scores(scores: Iterable[object]) -> list[float]:
    """Finite floats only; a missing/garbage score is not a signal."""
    cleaned: list[float] = []
    for score in scores or []:
        try:
            value = float(score)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if math.isfinite(value):
            cleaned.append(value)
    return cleaned


def compute_confidence(
    *,
    kb_scores: Iterable[object],
    qa_scores: Iterable[object],
) -> Optional[float]:
    """Best available retrieval signal, 0..1, or None when nothing was retrieved.

    A curated Q&A hit is a stronger signal than a chunk — it is the operator's
    own answer to that exact question — so it wins outright when present.
    """
    qa = _clean_scores(qa_scores)
    if qa:
        return max(0.0, min(1.0, max(qa)))
    kb = _clean_scores(kb_scores)
    if kb:
        return max(0.0, min(1.0, max(kb)))
    return None


def looks_like_fallback(
    answer: Optional[str], restricted_reply: Optional[str]
) -> bool:
    """True when the answer is a fallback sentence, i.e. the model did not answer.

    Compares against the agent's own `restricted_reply` *and* the built-in
    sentences. An empty/None answer counts as a fallback.
    """
    normalized = normalize_text(answer)
    if not normalized:
        return True

    candidates = list(BUILTIN_FALLBACK_REPLIES)
    if restricted_reply:
        candidates.append(restricted_reply)
    return any(normalize_text(candidate) == normalized for candidate in candidates)
