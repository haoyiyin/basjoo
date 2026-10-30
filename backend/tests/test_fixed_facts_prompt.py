"""Issue #39 — fixed facts: an operator-written layer that wins every message.

The block is hoisted out of the `if agent.kb_id` branch, so it is present even for
an agent with no KB bound and even when retrieval returns zero chunks. Order is
frozen: Q&A hits → fixed facts → `[来源N]` chunks.
"""

import pytest
from sqlalchemy import update

import database
from models import Agent
from tests.qa_fakes import fake_qa_index, make_http_request, recording_embeddings

HEADER = "以下是必须遵守的固定事实（优先级高于知识库资料；其中出现的链接必须原样输出）："
FACT_ONE = "营业地址：上海市徐汇区衡山路 100 号 3 楼。"
FACT_TWO = "预约链接：https://booking.example.com/new?ref=basjoo ，必须原样输出。"
CONTRADICTING_CHUNK = "门店已于 2020 年搬迁至北京，上海没有任何门店。"

async def _system_content(agent_id: str, message: str = "你们门店在哪里？") -> str:
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    request = ChatRequest(agent_id=agent_id, message=message, session_id=None, params={})
    async with database.AsyncSessionLocal() as db:
        result = await prepare_chat_request(request, make_http_request(), db)
    return result["messages"][0]["content"]

async def _set_fixed_facts(agent_id: str, value: str | None) -> None:
    async with database.AsyncSessionLocal() as session:
        await session.execute(
            update(Agent).where(Agent.id == agent_id).values(fixed_facts=value)
        )
        await session.commit()

async def _unbind_kb(agent_id: str) -> None:
    async with database.AsyncSessionLocal() as session:
        await session.execute(
            update(Agent).where(Agent.id == agent_id).values(kb_id=None)
        )
        await session.commit()

@pytest.mark.asyncio
async def test_fixed_facts_appear_with_no_kb_bound_and_zero_chunks(
    default_agent_id, fake_qa_index
):
    """Assertion 3: no KB bound at all — the facts are still in the prompt."""
    await _unbind_kb(default_agent_id)
    await _set_fixed_facts(default_agent_id, f"{FACT_ONE}\n\n{FACT_TWO}")

    content = await _system_content(default_agent_id)
    assert HEADER in content
    assert FACT_ONE in content
    assert FACT_TWO in content
    assert "https://booking.example.com/new?ref=basjoo" in content
    # There is real content, so the "nothing found" sentence must NOT be there.
    assert "No relevant information found" not in content

@pytest.mark.asyncio
async def test_fixed_facts_outrank_a_contradicting_chunk_and_come_before_it(
    default_agent_id, fake_qa_index, monkeypatch
):
    await _set_fixed_facts(default_agent_id, FACT_ONE)

    class FakeRetriever:
        async def retrieve(self, **kwargs):
            return [
                {
                    "text": CONTRADICTING_CHUNK,
                    "doc_id": "doc_1",
                    "chunk_index": 0,
                    "score": 0.9,
                    "filename": "store.txt",
                    "source_type": "file",
                    "source_url": "",
                    "source_title": "store.txt",
                }
            ]

    monkeypatch.setattr("api.v1.endpoints.KbRetrievalService", FakeRetriever)

    content = await _system_content(default_agent_id)
    assert CONTRADICTING_CHUNK in content
    assert FACT_ONE in content
    assert content.index(FACT_ONE) < content.index("[来源1]"), (
        "fixed facts sit above the retrieved chunks"
    )
    assert content.index(HEADER) < content.index("以下是相关背景资料：")

@pytest.mark.asyncio
async def test_fixed_facts_are_capped_at_six_passages(default_agent_id, fake_qa_index):
    passages = [f"固定事实第 {index} 条：这是一条必须遵守的说明。" for index in range(1, 10)]
    await _unbind_kb(default_agent_id)
    await _set_fixed_facts(default_agent_id, "\n\n".join(passages))

    content = await _system_content(default_agent_id)
    included = [text for text in passages if text in content]
    assert len(included) == 6, "only the first six passages may be injected"
    assert included == passages[:6]
    assert passages[6] not in content

@pytest.mark.asyncio
async def test_blank_fixed_facts_add_no_block(default_agent_id, fake_qa_index):
    await _unbind_kb(default_agent_id)
    await _set_fixed_facts(default_agent_id, "   \n\n   \n\n")

    content = await _system_content(default_agent_id)
    assert HEADER not in content
    assert "No relevant information found" in content, (
        "with every layer empty, today's exact sentence is kept"
    )

@pytest.mark.asyncio
async def test_put_fixed_facts_round_trips_and_feeds_the_prompt(
    client, default_agent_id, fake_qa_index
):
    saved = await client.put(
        f"/api/v1/agents/{default_agent_id}/fixed-facts",
        json={"fixed_facts": f"  {FACT_ONE}  "},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"fixed_facts": FACT_ONE}

    content = await _system_content(default_agent_id)
    assert FACT_ONE in content
    assert HEADER in content

    cleared = await client.put(
        f"/api/v1/agents/{default_agent_id}/fixed-facts",
        json={"fixed_facts": "   "},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json() == {"fixed_facts": None}
    assert HEADER not in await _system_content(default_agent_id)

@pytest.mark.asyncio
async def test_agent_payload_exposes_fixed_facts(client, default_agent_id, fake_qa_index):
    """The SPA textarea reads the value back from `GET /api/v1/agent`."""
    await client.put(
        f"/api/v1/agents/{default_agent_id}/fixed-facts",
        json={"fixed_facts": FACT_TWO},
    )
    response = await client.get(f"/api/v1/agent?agent_id={default_agent_id}")
    assert response.status_code == 200, response.text
    assert response.json()["fixed_facts"] == FACT_TWO

@pytest.mark.asyncio
async def test_fixed_facts_403_for_a_foreign_workspace_agent(
    client, fake_qa_index
):
    """A fixed-facts write is workspace-scoped like every other agent write."""
    from models import Agent, Workspace

    async with database.AsyncSessionLocal() as session:
        other = Workspace(name="Other", owner_email="other-facts@example.com")
        session.add(other)
        await session.commit()
        await session.refresh(other)
        foreign = Agent(workspace_id=other.id, name="Foreign")
        session.add(foreign)
        await session.commit()
        await session.refresh(foreign)
        foreign_id = foreign.id

    response = await client.put(
        f"/api/v1/agents/{foreign_id}/fixed-facts",
        json={"fixed_facts": FACT_ONE},
    )
    assert response.status_code == 403, response.text
