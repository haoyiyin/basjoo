"""Scripted keyword fallback (#60): answer a visitor from a curated pair, no LLM.

The third answer source. `agent.fallback_model` (#44) still costs a provider
round trip, and `restricted_reply` is a dead end; this one runs on the rows an
operator already curated in `qa_items` and touches nothing but the database.

Deliberately excluded from the semantic path (`QaService.search`): that path
*embeds the query*, which is exactly what is unavailable in the outage this
feature exists for. `match()` is pure stdlib — no network, no embeddings, no
randomness — so the same message against the same rows always picks the same
pair.

Matching, exactly as specified:

* normalise both sides once — NFKC, lowercase, non ``[\\w]`` → space, collapse,
  strip;
* a keyword matches when it occurs as a whole token (``" kw "`` in ``" msg "``)
  **or** as a contiguous substring of at least two characters;
* keywords shorter than 2 characters after normalisation never reach here (the
  write endpoint rejects them), but `match()` still ignores them as a belt-and-
  braces guard, so a row written before validation existed cannot match on a
  single letter;
* score is one point per matched keyword; ties break by ``hits`` desc then
  ``id`` asc, which is what makes the ordering deterministic.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import QaItem

# Anything that is not a letter, digit or underscore becomes a separator.
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")

# A one-character keyword ("款", "a") would match almost every message, so the
# contract is: reject it at write time, and never match on it here either.
MIN_KEYWORD_LENGTH = 2

# The two modes that make the keyword path reachable at all.
KEYWORD_MODES = frozenset({"keyword", "llm_then_keyword"})

@dataclass(frozen=True)
class KeywordHit:
    """One served pair. Frozen so a caller cannot mutate what it was given."""

    qa_id: str
    question: str
    answer: str
    score: float
    matched: list[str]

def normalize(text: str) -> str:
    """NFKC → lowercase → punctuation to space → collapse → strip.

    NFKC first so the full-width forms a Chinese IME produces (`，？！`, `Ａ`)
    fold to their ASCII counterparts before the separator pass, and so
    `Ｒｅｔｕｒｎ` becomes the `return` an operator typed.
    """
    if not text:
        return ""
    folded = unicodedata.normalize("NFKC", text).lower()
    spaced = _NON_WORD.sub(" ", folded)
    return _WHITESPACE.sub(" ", spaced).strip()

def _field(item: Any, name: str, default: Any = None) -> Any:
    """Read *name* off an ORM row, a dataclass or a plain dict (the bench)."""
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)

def _keywords(item: Any) -> list[str]:
    """The pair's normalised keywords, blanks and one-char entries dropped."""
    raw = _field(item, "keywords") or []
    if isinstance(raw, str):
        # Defensive: a row written before the JSON column existed, or a
        # hand-edited database, may carry a plain string.
        raw = raw.split(",")
    if not isinstance(raw, (list, tuple, set)):
        return []
    keywords: list[str] = []
    for keyword in raw:
        if not isinstance(keyword, str):
            continue
        normalised = normalize(keyword)
        if len(normalised) < MIN_KEYWORD_LENGTH:
            continue
        keywords.append(normalised)
    return keywords

def match(items: Iterable[Any], message: str) -> KeywordHit | None:
    """Best match for *message*, or ``None`` when nothing matches.

    *items* is anything with ``id``, ``question``, ``answer``, ``keywords``,
    ``hits`` and ``enabled`` — ORM rows or plain dicts, so the benchmark can
    build 1000 fakes without a database.

    Ordering is total and deterministic: ``score`` desc, ``hits`` desc,
    ``id`` asc.
    """
    normalised_message = normalize(message)
    if not normalised_message:
        return None
    # Token matching needs the padded form; substring matching uses the plain
    # one. Both derive from the same normalised message.
    padded_message = f" {normalised_message} "

    # Sort key is (-score, -hits, id): lower wins. Building it as a tuple means
    # one comparison, so "best" and the two tie-breaks can never drift apart.
    best_key: tuple[float, int, str] | None = None
    best_item: Any = None
    best_matched: list[str] = []
    best_score = 0.0

    for item in items:
        if not _field(item, "enabled", True):
            continue
        keywords = _keywords(item)
        if not keywords:
            continue

        matched: list[str] = []
        for keyword in keywords:
            # Whole token first, then the documented ≥2-character substring.
            # One-character keywords never get here: `_keywords()` drops them.
            if f" {keyword} " in padded_message:
                matched.append(keyword)
            elif keyword in normalised_message:
                matched.append(keyword)
        if not matched:
            continue

        # Issue text: "matched keyword length ÷ keyword length, summed" — i.e.
        # 1.0 per matched keyword. Kept a float because the UI renders it.
        score = float(sum(len(kw) / max(len(kw), 1) for kw in matched))
        key = (-score, -int(_field(item, "hits", 0) or 0), str(_field(item, "id", "")))

        if best_key is None or key < best_key:
            best_key = key
            best_item = item
            best_matched = matched
            best_score = score

    if best_item is None:
        return None

    return KeywordHit(
        qa_id=str(_field(best_item, "id", "")),
        question=_field(best_item, "question", "") or "",
        answer=_field(best_item, "answer", "") or "",
        score=best_score,
        matched=best_matched,
    )

async def match_for_kb(
    db: AsyncSession, kb_id: str, message: str
) -> KeywordHit | None:
    """One SELECT over one KB's enabled pairs, then `match()`.

    No embedding call, no Qdrant, no provider — this is the whole point.
    An unknown ``kb_id`` is simply "no rows" → ``None``.
    """
    if not kb_id:
        return None
    rows = (
        await db.scalars(
            select(QaItem).where(
                QaItem.kb_id == kb_id,
                QaItem.enabled.is_(True),
            )
        )
    ).all()
    if not rows:
        return None
    return match(rows, message)

async def keyword_mode_enabled(agent: Any) -> bool:
    """True when the agent's ``fallback_mode`` opts into the keyword path.

    An unknown or absent value reads as ``off``: an upgrade that does not set
    the column must change nothing.
    """
    if agent is None:
        return False
    mode = _field(agent, "fallback_mode", None)
    if not isinstance(mode, str):
        return False
    return mode.strip().lower() in KEYWORD_MODES
