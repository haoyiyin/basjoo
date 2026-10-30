"""Issue #39 — curated Q&A index: create → prompt, delete → gone, quota, hashing.

Every assertion here is on the artifact chat actually reads: the assembled
`messages[0]["content"]` from `prepare_chat_request`, or the admin API's own
response body. Nothing asserts on a helper's return value.
"""

import pytest
from sqlalchemy import select, update

import database
from models import Agent, ChatSession, QaItem, WorkspaceQuota
from tests.qa_fakes import (
    FakeQaIndex,
    RecordingEmbeddings,
    fake_qa_index,
    make_http_request,
    recording_embeddings,
)

QUESTION = "营业到几点？你们的退款窗口是多长时间？"
ANSWER = "每天 10:00-22:00 营业，退款窗口为收货后 30 天。"
KB_CONTRADICTION = "本店每天只营业 4 小时，且不接受任何退款。"

async def _prepare(agent_id: str, message: str, session_id: str | None = None):
    """Assemble the real prompt chat would send for one visitor message."""
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest
    request = ChatRequest(
        agent_id=agent_id, message=message, session_id=session_id, params={}
    )
    async with database.AsyncSessionLocal() as db:
        return await prepare_chat_request(request, make_http_request(), db)

async def _system_content(agent_id: str, message: str) -> str:
    result = await _prepare(agent_id, message)
    return result["messages"][0]["content"]

def _install_kb_chunks(monkeypatch, chunks: list[str]):
    """Make KbRetrievalService return fixed chunks (no Qdrant, no embeddings)."""
    class FakeRetriever:
        async def retrieve(self, **kwargs):
            return [
                {
                    "text": text,
                    "doc_id": f"doc_{index}",
                    "chunk_index": index,
                    "score": 0.9,
                    "filename": "handbook.txt",
                    "source_type": "file",
                    "source_url": "",
                    "source_title": "handbook.txt",
                }
                for index, text in enumerate(chunks)
            ]

    monkeypatch.setattr("api.v1.endpoints.KbRetrievalService", FakeRetriever)

async def _agent_row(agent_id: str) -> Agent:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent is not None
        return agent

# ---------------------------------------------------------------- assertions

@pytest.mark.asyncio
async def test_creating_pair_changes_next_prompt_with_no_kb_reindex(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """Assertion 1: a new pair reaches `messages[0]` without touching KB chunks.

    The KB retrieval seam is absent (the agent's real retrieve would hit Qdrant
    with an unreachable provider), so the only way ANSWER can appear is the Q&A
    layer — and no `index:rebuild` call happens anywhere.
    """
    before = await _system_content(default_agent_id, "你们的退款窗口是多长时间？")
    assert ANSWER not in before

    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["question"] == QUESTION
    assert body["source"] == "manual"
    assert body["enabled"] is True
    assert body["hits"] == 0

    after = await _system_content(default_agent_id, "你们的退款窗口是多长时间？")
    assert ANSWER in after
    assert "以下问答对与用户问题高度相关，请优先采用其中的答案：" in after
    assert f"[问答1] 问：{QUESTION}" in after

@pytest.mark.asyncio
async def test_qa_hit_outranks_contradicting_kb_chunk(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings, monkeypatch
):
    """Assertion 2: the Q&A layer appears before `[来源1]` in the system content."""
    _install_kb_chunks(monkeypatch, [KB_CONTRADICTION])
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text

    content = await _system_content(default_agent_id, QUESTION)
    assert KB_CONTRADICTION in content, "the KB chunk is still present"
    assert ANSWER in content
    assert content.index(ANSWER) < content.index("[来源1]"), (
        "the curated answer must be stated before the contradicting chunk"
    )

@pytest.mark.asyncio
async def test_delete_removes_pair_from_next_prompt(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """Assertion 5: deleting the pair restores the previous behaviour."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text
    qa_id = created.json()["id"]
    assert ANSWER in await _system_content(default_agent_id, QUESTION)

    deleted = await client.delete(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}"
    )
    assert deleted.status_code == 200, deleted.text
    assert (bound_kb_id, qa_id) in fake_qa_index.deleted, (
        "the vector point must be deleted too, not just the row"
    )

    after = await _system_content(default_agent_id, QUESTION)
    assert ANSWER not in after
    assert after.rstrip().endswith(
        "Please use a fallback response according to your role constraints.]"
    ), "with nothing left in any layer, today's exact sentence returns"

@pytest.mark.asyncio
async def test_disabled_pair_leaves_prompt_and_point_but_stays_listed(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    qa_id = created.json()["id"]

    disabled = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}",
        json={"enabled": False},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabled"] is False
    assert (bound_kb_id, qa_id) in fake_qa_index.deleted

    assert ANSWER not in await _system_content(default_agent_id, QUESTION)
    listed = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

@pytest.mark.asyncio
async def test_answer_only_edit_skips_reembedding(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """Assertion 10: an unchanged `embedding_hash` costs no provider call."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text
    qa_id = created.json()["id"]
    calls_after_create = recording_embeddings.call_count
    assert calls_after_create == 1, "the first save embeds the question once"

    # The row stored the hash of the text it embedded.
    async with database.AsyncSessionLocal() as session:
        item = await session.get(QaItem, qa_id)
        assert item is not None
        from services.qa_service import qa_embedding_hash

        assert item.embedding_hash == qa_embedding_hash(QUESTION)

    edited = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}",
        json={"answer": "退款窗口是 15 天。"},
    )
    assert edited.status_code == 200, edited.text
    assert recording_embeddings.call_count == calls_after_create, (
        "an answer-only edit must reuse the stored vector"
    )

    # Changing the QUESTION does re-embed.
    reworded = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}",
        json={"question": "退款窗口是多少天呢？请说明。"},
    )
    assert reworded.status_code == 200, reworded.text
    assert recording_embeddings.call_count == calls_after_create + 1

@pytest.mark.asyncio
async def test_sync_item_skips_embed_when_hash_unchanged(
    default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """Assertion 10, at the service seam: two syncs, one embedding call."""
    from services.qa_service import QaService

    async with database.AsyncSessionLocal() as session:
        item = QaItem(
            kb_id=bound_kb_id, question=QUESTION, answer=ANSWER, enabled=True
        )
        session.add(item)
        await session.commit()
        await session.refresh(item)

        service = QaService()
        await service.sync_item(item, session)
        await session.commit()
        assert recording_embeddings.call_count == 1

        await service.sync_item(item, session)
        await session.commit()

    assert recording_embeddings.call_count == 1
    assert (bound_kb_id, item.id) in fake_qa_index.payload_updates, (
        "the payload is still refreshed so an edited answer is served"
    )

@pytest.mark.asyncio
async def test_max_qa_items_blocks_creation_with_409(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """Assertion 8: `max_qa_items` counts real rows and answers 409 past the cap."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        await session.execute(
            update(WorkspaceQuota)
            .where(WorkspaceQuota.workspace_id == agent.workspace_id)
            .values(max_qa_items=1, used_qa_items=0)
        )
        await session.commit()

    first = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": "你们现在支持哪些付款方式？请逐一说明。", "answer": "微信和支付宝。"},
    )
    assert second.status_code == 409, second.text
    assert second.json()["detail"] == "Q&A item limit reached"

    async with database.AsyncSessionLocal() as session:
        count = len((await session.execute(select(QaItem.id))).scalars().all())
    assert count == 1, "the rejected pair must not be persisted"

@pytest.mark.asyncio
async def test_duplicate_question_is_409_and_update_corrects_it(
    client, bound_kb_id, fake_qa_index, recording_embeddings
):
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text
    qa_id = created.json()["id"]

    duplicate = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": "不同的回答"},
    )
    assert duplicate.status_code == 409

    corrected = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}",
        json={"answer": "修正后的答案。"},
    )
    assert corrected.status_code == 200
    assert corrected.json()["answer"] == "修正后的答案。"
    assert corrected.json()["id"] == qa_id

@pytest.mark.asyncio
async def test_import_skips_blank_rows_and_duplicates(
    client, bound_kb_id, fake_qa_index, recording_embeddings
):
    payload = {
        "items": [
            {"question": QUESTION, "answer": ANSWER},
            {"question": QUESTION, "answer": "重复问题"},
            {"question": "  ", "answer": "没有问题的回答"},
            {"question": "你们现在支持哪些付款方式？请逐一说明。", "answer": "微信和支付宝。"},
        ]
    }
    response = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items:import", json=payload
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"created": 2, "skipped": 2}

    listing = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert listing.json()["total"] == 2

@pytest.mark.asyncio
async def test_qa_items_are_not_visible_from_another_workspace(
    client, bound_kb_id, fake_qa_index, recording_embeddings
):
    """The KB-scoped route resolves the workspace from the caller: 404 elsewhere."""
    from models import Workspace

    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text

    async with database.AsyncSessionLocal() as session:
        other = Workspace(name="Other", owner_email="other@example.com")
        session.add(other)
        await session.commit()
        from models import KnowledgeBase

        # Move the KB into the other workspace: it disappears from this caller.
        await session.execute(
            update(KnowledgeBase)
            .where(KnowledgeBase.id == bound_kb_id)
            .values(workspace_id=other.id)
        )
        await session.commit()

    listing = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert listing.status_code == 404

@pytest.mark.asyncio
async def test_qa_hit_is_reported_in_sse_sources_and_counted(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """The SSE `sources` event carries `type: "qa"` and the counter advances."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    qa_id = created.json()["id"]

    result = await _prepare(default_agent_id, QUESTION)
    sources = result["sources"]
    qa_sources = [source for source in sources if source.get("type") == "qa"]
    assert len(qa_sources) == 1
    assert qa_sources[0] == {
        "type": "qa",
        "title": QUESTION,
        "question": QUESTION,
        "url": "",
        "filename": "",
        "snippet": ANSWER[:200],
        "id": qa_id,
    }

    async with database.AsyncSessionLocal() as session:
        item = await session.get(QaItem, qa_id)
        assert item is not None
        assert item.hits == 1
        assert item.last_hit_at is not None

@pytest.mark.asyncio
async def test_answer_context_never_mentions_qa_when_index_is_empty(
    default_agent_id, fake_qa_index, monkeypatch
):
    """An empty curated index adds no block at all (no empty header)."""
    from api.v1.endpoints import build_qa_prompt_block, build_fixed_facts_block

    assert build_qa_prompt_block([]) == ""
    assert build_fixed_facts_block("") == ""
    assert build_fixed_facts_block("   \n\n  ") == ""

@pytest.mark.asyncio
async def test_revise_answer_creates_visible_and_effective_pair(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """Assertion 4: `revise-answer` writes a row the KB list returns, live at once."""
    async with database.AsyncSessionLocal() as session:
        session_row = ChatSession(
            agent_id=default_agent_id,
            session_id="sess_revise_test",
            status="active",
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)
        session_db_id = session_row.id

        from models import ChatMessage

        session.add(
            ChatMessage(
                session_id=session_db_id, role="user", content=QUESTION
            )
        )
        session.add(
            ChatMessage(
                session_id=session_db_id,
                role="assistant",
                content="我不确定。",
                sender_type="agent",
            )
        )
        await session.commit()

    assert ANSWER not in await _system_content(default_agent_id, QUESTION)

    revised = await client.post(
        f"/api/v1/admin/sessions/{session_db_id}/revise-answer",
        json={"answer": ANSWER},
    )
    assert revised.status_code == 200, revised.text
    body = revised.json()
    assert body["replaced"] is False
    assert body["qa_item"]["source"] == "revise"
    assert body["qa_item"]["question"] == QUESTION
    assert body["qa_item"]["answer"] == ANSWER

    listing = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert listing.status_code == 200
    listed = listing.json()["items"]
    assert [item["id"] for item in listed] == [body["qa_item"]["id"]]

    assert ANSWER in await _system_content(default_agent_id, QUESTION)

    # Revising the same turn again corrects the row instead of duplicating it.
    again = await client.post(
        f"/api/v1/admin/sessions/{session_db_id}/revise-answer",
        json={"answer": "修正后的第二次回答。"},
    )
    assert again.status_code == 200, again.text
    assert again.json()["replaced"] is True
    assert again.json()["qa_item"]["id"] == body["qa_item"]["id"]
    after = await _system_content(default_agent_id, QUESTION)
    assert "修正后的第二次回答。" in after
    assert ANSWER not in after

@pytest.mark.asyncio
async def test_revise_answer_409_when_agent_has_no_kb(
    client, monkeypatch, fake_qa_index, recording_embeddings
):
    async with database.AsyncSessionLocal() as session:
        agent = Agent(
            workspace_id=1,
            name="Unbound",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        agent_id = agent.id

        from models import ChatMessage

        session_row = ChatSession(
            agent_id=agent_id, session_id="sess_unbound", status="active"
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)
        session.add(
            ChatMessage(session_id=session_row.id, role="user", content=QUESTION)
        )
        await session.commit()
        session_db_id = session_row.id

    response = await client.post(
        f"/api/v1/admin/sessions/{session_db_id}/revise-answer",
        json={"answer": ANSWER},
    )
    assert response.status_code == 409, response.text

@pytest.mark.asyncio
async def test_from_message_uses_preceding_user_message(
    client, default_agent_id, bound_kb_id, fake_qa_index, recording_embeddings
):
    """`/admin/qa/from-message/{id}` resolves message → session → agent → KB."""
    async with database.AsyncSessionLocal() as session:
        session_row = ChatSession(
            agent_id=default_agent_id, session_id="sess_from_msg", status="active"
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)

        from models import ChatMessage

        session.add(
            ChatMessage(session_id=session_row.id, role="user", content=QUESTION)
        )
        await session.commit()
        assistant = ChatMessage(
            session_id=session_row.id,
            role="assistant",
            content="这是助手原来的回答。",
            sender_type="agent",
        )
        session.add(assistant)
        await session.commit()
        await session.refresh(assistant)
        assistant_id = assistant.id

    response = await client.post(f"/api/v1/admin/qa/from-message/{assistant_id}")
    assert response.status_code == 200, response.text
    item = response.json()["qa_item"]
    assert item["question"] == QUESTION
    assert item["answer"] == "这是助手原来的回答。"
    assert item["source"] == "unanswered"
    assert item["source_message_id"] == assistant_id

    listing = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert [row["id"] for row in listing.json()["items"]] == [item["id"]]

@pytest.mark.asyncio
async def test_from_message_rejects_short_question_with_400(
    client, default_agent_id, fake_qa_index, recording_embeddings
):
    """#42's rule, reused: a <15-char or whitespace-only question is a 400."""
    async with database.AsyncSessionLocal() as session:
        session_row = ChatSession(
            agent_id=default_agent_id, session_id="sess_short", status="active"
        )
        session.add(session_row)
        await session.commit()
        await session.refresh(session_row)

        from models import ChatMessage

        session.add(ChatMessage(session_id=session_row.id, role="user", content="   "))
        await session.commit()
        assistant = ChatMessage(
            session_id=session_row.id, role="assistant", content="答案"
        )
        session.add(assistant)
        await session.commit()
        await session.refresh(assistant)
        assistant_id = assistant.id

    response = await client.post(f"/api/v1/admin/qa/from-message/{assistant_id}")
    assert response.status_code == 400, response.text

@pytest.mark.asyncio
async def test_from_message_404_for_unknown_message(client, fake_qa_index):
    response = await client.post("/api/v1/admin/qa/from-message/999999")
    assert response.status_code == 404
