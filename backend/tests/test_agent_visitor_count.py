"""`visitor_count` on the agent payload counts distinct visitors, not sessions.

One agent, five sessions: three share a visitor id, one has a second id, one is
anonymous (`visitor_id=None`). The counter must read 2 — a row count would read
5, and an unfiltered distinct would read 3.
"""

import database
from sqlalchemy import select
from api.v1.endpoints import build_agent_config_with_stats
from models import Agent, ChatSession


async def test_visitor_count_counts_distinct_non_empty_visitors(setup_test_db):
    async with database.AsyncSessionLocal() as session:
        agent = (
            await session.execute(
                select(Agent).where(Agent.is_active).order_by(Agent.created_at)
            )
        ).scalars().first()
        assert agent is not None

        session.add_all(
            [
                ChatSession(
                    agent_id=agent.id,
                    session_id="sess_a1",
                    visitor_id="visitor_A",
                ),
                ChatSession(
                    agent_id=agent.id,
                    session_id="sess_a2",
                    visitor_id="visitor_A",
                ),
                ChatSession(
                    agent_id=agent.id,
                    session_id="sess_a3",
                    visitor_id="visitor_A",
                ),
                ChatSession(
                    agent_id=agent.id,
                    session_id="sess_b1",
                    visitor_id="visitor_B",
                ),
                ChatSession(
                    agent_id=agent.id,
                    session_id="sess_anon",
                    visitor_id=None,
                ),
            ]
        )
        await session.commit()

        config = await build_agent_config_with_stats(agent, session)

    assert config["visitor_count"] == 2
    # The two other counters keep their own meaning on the same payload.
    assert config["active_session_count"] == 5
