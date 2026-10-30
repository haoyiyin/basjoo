"""Quota weighting (#44) — one hook, no pricing table.

The workspace counter is a *message* counter: ``used_messages_today`` counts
answered messages, not tokens and not dollars. The issue's "GPT-4.1 costs 10×
mini" idea is the reason this module exists at all — instead of threading a
price through the chat path (which would make every new model a code change),
the increment asks a single function how much one message from this model
costs.

Today every model costs 1, including a *degraded* (fallback) answer. That is
deliberate and documented: the operator is already paying for the primary
model they did not get, because the primary allowance is what ran out. Charging
the visitor twice for the same conversation would make degradation pointless.

A deployment that really wants a weighted mix changes `message_weight` (or the
`MODEL_WEIGHTS` map below) and nothing else — no chat-path edit, no migration,
because the weight is applied at increment time and never stored.
"""

from __future__ import annotations

# Per-model message weight. Empty today: `message_weight` falls through to the
# default. Keys are model names exactly as the operator types them.
MODEL_WEIGHTS: dict[str, int] = {}

DEFAULT_MESSAGE_WEIGHT = 1

def message_weight(model: str) -> int:
    """How much one answered message from `model` costs the daily allowance.

    Applied at increment time only — the counter stores messages, not weights,
    so changing this never needs a migration or a backfill.
    """
    if not model:
        return DEFAULT_MESSAGE_WEIGHT
    weight = MODEL_WEIGHTS.get(str(model).strip())
    if weight is None:
        return DEFAULT_MESSAGE_WEIGHT
    try:
        return int(weight)
    except (TypeError, ValueError):
        return DEFAULT_MESSAGE_WEIGHT
