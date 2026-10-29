"""Procedures (#39): one human-written step per turn, skip-whole-procedure rule.

A procedure is an ordered list of steps. The bot is told to run exactly one step
this turn and wait for the visitor. The counter-intuitive rule copied from the
vendors: if *any* step needs an action the current channel cannot perform, the
entire procedure is skipped — never half-executed — because a step-2 form with no
step-1 link is worse than no procedure at all.

State lives on `ChatSession.active_procedure_id` / `procedure_step` so the step
advances deterministically instead of being re-derived from message ordering.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Agent, ChatSession, Procedure

logger = logging.getLogger(__name__)

# Actions the chat channel can perform. `link` is always available; `form` only
# when a lead/prechat form is configured on the agent (#41 owns that field, so
# this is read attr-by-attr and degrades to "not configured").
ALWAYS_AVAILABLE_ACTIONS = frozenset({"link"})
FORM_CONFIG_ATTRS = ("prechat_form", "lead_capture_form", "lead_capture")

def available_channel_actions(agent: Agent | None) -> set[str]:
    """Actions the visitor's channel can actually perform right now."""
    actions = set(ALWAYS_AVAILABLE_ACTIONS)
    for attr in FORM_CONFIG_ATTRS:
        if getattr(agent, attr, None):
            actions.add("form")
            break
    return actions

def _normalise_steps(steps: Any) -> list[dict[str, Any]]:
    """Coerce the JSON column into `[{"text", "requires_action"}]`.

    A malformed row must not leak an exception into the chat path: anything that
    is not a non-empty text step is dropped.
    """
    if not isinstance(steps, list):
        return []
    normalised: list[dict[str, Any]] = []
    for raw in steps:
        if isinstance(raw, str):
            text = raw.strip()
            if text:
                normalised.append({"text": text, "requires_action": None})
            continue
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        action = raw.get("requires_action")
        normalised.append(
            {
                "text": text,
                "requires_action": str(action) if action else None,
            }
        )
    return normalised

def unsupported_action(procedure: Procedure, actions: set[str]) -> str | None:
    """First `requires_action` this channel cannot perform, or None."""
    for step in _normalise_steps(procedure.steps):
        required = step.get("requires_action")
        if required and required not in actions:
            return required
    return None

async def select_procedure(db: AsyncSession, agent_id: str) -> Procedure | None:
    """The agent's first enabled procedure, oldest first."""
    result = await db.execute(
        select(Procedure)
        .where(Procedure.agent_id == agent_id, Procedure.enabled.is_(True))
        .order_by(Procedure.created_at.asc(), Procedure.id.asc())
        .limit(1)
    )
    return result.scalars().first()

def build_procedure_block(procedure: Procedure, step_index: int) -> str:
    """The numbered step list plus the one-step-per-turn rule."""
    steps = _normalise_steps(procedure.steps)
    lines = [
        f"当前流程「{procedure.name}」共 {len(steps)} 步，"
        f"本轮只执行第 {step_index + 1} 步并等待用户回应："
    ]
    for index, step in enumerate(steps, 1):
        lines.append(f"{index}. {step['text']}")
    return "\n".join(lines)

def _clear_session_procedure(session: ChatSession) -> None:
    session.active_procedure_id = None
    session.procedure_step = 0

async def resolve_active_procedure(
    db: AsyncSession,
    session: ChatSession | None,
    agent: Agent,
) -> str:
    """Return the procedure block to inject this turn ('' when none applies).

    On the turn a procedure is attached, step 1 runs and `procedure_step`
    becomes 1. Each later turn runs the next step and increments the pointer. The
    turn after the last step clears both fields and injects nothing, so an
    exhausted procedure does not stay attached forever.
    """
    if session is None or not getattr(agent, "id", None):
        return ""

    procedure = await select_procedure(db, agent.id)
    if not procedure:
        if getattr(session, "active_procedure_id", None):
            _clear_session_procedure(session)
            await db.commit()
        return ""

    steps = _normalise_steps(procedure.steps)
    if not steps:
        return ""

    # A step that needs an action this channel lacks kills the whole procedure.
    missing = unsupported_action(procedure, available_channel_actions(agent))
    if missing:
        logger.info(
            "Procedure %s ('%s') skipped for agent %s: step requires unavailable "
            "action %r (channel provides %s)",
            procedure.id,
            procedure.name,
            agent.id,
            missing,
            sorted(available_channel_actions(agent)),
        )
        if getattr(session, "active_procedure_id", None) == procedure.id:
            _clear_session_procedure(session)
            await db.commit()
        return ""

    attached_to = getattr(session, "active_procedure_id", None)
    step_index = int(getattr(session, "procedure_step", 0) or 0)

    if attached_to != procedure.id:
        # Fresh attachment (or the agent switched procedures): start at step 1.
        step_index = 0

    if step_index >= len(steps):
        # Every step already ran: detach instead of restarting the script.
        _clear_session_procedure(session)
        await db.commit()
        return ""

    block = build_procedure_block(procedure, step_index)
    session.active_procedure_id = procedure.id
    session.procedure_step = step_index + 1
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info(
        "Procedure %s step %s/%s injected for session %s",
        procedure.id,
        step_index + 1,
        len(steps),
        getattr(session, "id", "?"),
    )
    return block
