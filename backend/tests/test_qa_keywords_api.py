"""Issue #60 — the operator's half of the keyword fallback.

Four promises under test here, all through the admin API or the write path chat
actually reads:

1. `keywords` round-trips on list/create/update;
2. validation rejects a trigger the matcher could never use (`<2` chars after
   `keyword_fallback.normalize`, or blank) with a machine-readable detail, and
   dedupes instead of duplicating;
3. `POST /knowledge-bases/{kb_id}/qa-items:match` answers exactly what the chat
   seam would serve — same matcher, KB-scoped, and **zero** provider calls;
4. the keyword editor cannot lose its keywords when a save *corrects* an
   existing pair.

The zero-provider assertion is a call count on the real embedding seam
(`DocumentParser.embed_texts`), not on a helper: reverting the endpoint to an
embedding path turns it red.
"""

import pytest
from sqlalchemy import select

import database
from models import QaItem
from services.document_parser import DocumentParser
# `fake_qa_index` is the #39 in-memory Qdrant stand-in; importing it here
# registers the fixture (it lives beside the tests, not in conftest).
from tests.qa_fakes import fake_qa_index  # noqa: F401

QUESTION = "你们的退款窗口是多长时间？请说明。"
ANSWER = "收货后 30 天内可无理由退款。"

#: Deterministic vector, width 8 — the KB self-heals its dimension from it.
EMBEDDING = [0.01] * 8


class _CountingEmbedder:
    """Counts every provider round trip so the assertion is a call count."""

    def __init__(self):
        self.call_count = 0

    async def __call__(self, texts, model, base_url, api_key=None, **kwargs):
        self.call_count += 1
        return [list(EMBEDDING) for _ in texts]


@pytest.fixture
def counting_embeddings(monkeypatch):
    counter = _CountingEmbedder()
    monkeypatch.setattr(DocumentParser, "embed_texts", counter, raising=True)
    return counter


def _match_url(kb_id: str) -> str:
    return f"/api/v1/knowledge-bases/{kb_id}/qa-items:match"


# ------------------------------------------------------------- round-trip

@pytest.mark.asyncio
async def test_keywords_round_trip_on_create_list_and_update(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """`keywords` survives create → list → update, normalised by the matcher."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["退款", "Refund"]},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    # Stored in the matcher's own normal form: lowercased, NFKC-folded.
    assert body["keywords"] == ["退款", "refund"]

    listed = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert listed.status_code == 200, listed.text
    [row] = listed.json()["items"]
    assert row["keywords"] == ["退款", "refund"]

    updated = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{body['id']}",
        json={"keywords": ["退货", "exchange"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["keywords"] == ["退货", "exchange"]

    # `keywords` absent means "leave them alone" — an answer-only edit is common.
    untouched = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{body['id']}",
        json={"answer": "退款窗口 15 天。"},
    )
    assert untouched.status_code == 200, untouched.text
    assert untouched.json()["keywords"] == ["退货", "exchange"]

    cleared = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{body['id']}",
        json={"keywords": []},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["keywords"] == []


@pytest.mark.asyncio
async def test_create_without_keywords_returns_empty_list(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """A pair with no trigger words still works semantically; `[]`, never null."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER},
    )
    assert created.status_code == 201, created.text
    assert created.json()["keywords"] == []


# ------------------------------------------------------------- validation

@pytest.mark.asyncio
async def test_one_character_keyword_is_rejected_with_machine_readable_detail(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """The matcher ignores a 1-char keyword, so the API must not accept one."""
    rejected = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["款"]},
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"] == "keyword_too_short: 款"

    async with database.AsyncSessionLocal() as session:
        stored = (
            await session.execute(select(QaItem).where(QaItem.kb_id == bound_kb_id))
        ).scalars().all()
    assert stored == [], "a rejected create must not leave a partial row behind"


@pytest.mark.asyncio
async def test_blank_keyword_is_rejected_not_silently_dropped(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """A blank entry normalises to `''`; dropping it would hide the mistake."""
    rejected = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["   "]},
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"] == "keyword_too_short: "


@pytest.mark.asyncio
async def test_validation_runs_on_update_too(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["退款"]},
    )
    assert created.status_code == 201, created.text
    qa_id = created.json()["id"]

    rejected = await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}",
        json={"keywords": ["退款", "a"]},
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"] == "keyword_too_short: a"

    # The stored value is untouched by a rejected write.
    listed = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items")
    assert listed.json()["items"][0]["keywords"] == ["退款"]


@pytest.mark.asyncio
async def test_full_width_keyword_folds_to_the_matcher_form(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """`Ｒｅｔｕｒｎ` is stored as `return` — one normaliser, both sides."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={
            "question": QUESTION,
            "answer": ANSWER,
            "keywords": ["Ｒｅｔｕｒｎ", "退款！", "  退货  "],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["keywords"] == ["return", "退款", "退货"]


@pytest.mark.asyncio
async def test_duplicates_are_deduped_preserving_first_seen_order(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={
            "question": QUESTION,
            "answer": ANSWER,
            "keywords": ["退款", "Refund", "退款", "REFUND", "退货"],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["keywords"] == ["退款", "refund", "退货"]


@pytest.mark.asyncio
async def test_keyword_caps_are_20_per_pair_and_40_characters_each(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    too_many = [f"keyword{index:02d}" for index in range(21)]
    rejected = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": too_many},
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"].startswith("too_many_keywords:")

    too_long = "x" * 41
    rejected_long = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": [too_long]},
    )
    assert rejected_long.status_code == 400, rejected_long.text
    assert rejected_long.json()["detail"] == f"keyword_too_long: {too_long}"

    # Exactly the cap is accepted — the boundary is inclusive.
    accepted = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={
            "question": QUESTION,
            "answer": ANSWER,
            "keywords": [f"keyword{index:02d}" for index in range(20)],
        },
    )
    assert accepted.status_code == 201, accepted.text
    assert len(accepted.json()["keywords"]) == 20


# --------------------------------------------------------- correct-a-pair

@pytest.mark.asyncio
async def test_create_helper_carries_keywords_on_the_correction_branch(
    bound_kb_id, fake_qa_index, counting_embeddings
):
    """Re-saving a question corrects the pair — and rewrites its keywords.

    The "correct the existing pair" branch is reachable from bulk import and
    revise-answer, not from `POST /qa-items` (which 409s), so it is exercised at
    the helper it lives in.
    """
    from api.v1.qa_endpoints import _create_qa_item
    from models import KnowledgeBase

    async with database.AsyncSessionLocal() as session:
        kb_row = await session.get(KnowledgeBase, bound_kb_id)
        assert kb_row is not None

        first, replaced_first = await _create_qa_item(
            session, kb_row, question=QUESTION, answer=ANSWER, keywords=["退款"]
        )
        assert replaced_first is False
        assert first.keywords == ["退款"]

        second, replaced = await _create_qa_item(
            session,
            kb_row,
            question=QUESTION,
            answer="退款窗口 15 天。",
            keywords=["退货"],
        )
        assert replaced is True, "same question means 'correct', not 'insert'"
        assert second.id == first.id
        assert second.keywords == ["退货"], (
            "a corrected pair must not keep the stale trigger words"
        )

        # `keywords=None` (the transcript write-back routes) leaves them alone.
        third, _ = await _create_qa_item(
            session, kb_row, question=QUESTION, answer="退款窗口 7 天。"
        )
        assert third.keywords == ["退货"]


# ------------------------------------------------------------ match tester

@pytest.mark.asyncio
async def test_match_endpoint_serves_the_winning_pair_with_no_provider_call(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """A hit: the pair, its score and the keywords that fired — zero embeddings."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["退款", "refund"]},
    )
    assert created.status_code == 201, created.text
    qa_id = created.json()["id"]
    calls_after_create = counting_embeddings.call_count
    assert calls_after_create >= 1, "the create path really does embed once"

    result = await client.post(
        _match_url(bound_kb_id), json={"message": "我要申请退款，怎么操作？"}
    )
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["matched"] is not None, "the substring rule must fire here"
    assert body["matched"]["id"] == qa_id
    assert body["matched"]["question"] == QUESTION
    assert body["matched"]["answer"] == ANSWER
    assert body["matched_keywords"] == ["退款"]
    assert body["score"] == pytest.approx(1.0)

    assert counting_embeddings.call_count == calls_after_create, (
        "the tester must not embed the message — that is the whole point of the "
        "keyword path"
    )


@pytest.mark.asyncio
async def test_match_endpoint_reports_a_miss_as_200_with_null(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """A miss is a normal answer in chat, so it is a 200 here too — not an error."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["退款"]},
    )
    assert created.status_code == 201, created.text

    result = await client.post(
        _match_url(bound_kb_id), json={"message": "你们支持哪些付款方式？"}
    )
    assert result.status_code == 200, result.text
    assert result.json() == {
        "matched": None,
        "score": None,
        "matched_keywords": [],
    }


@pytest.mark.asyncio
async def test_match_endpoint_never_matches_a_disabled_pair(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["退款"]},
    )
    qa_id = created.json()["id"]
    await client.put(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items/{qa_id}",
        json={"enabled": False},
    )

    result = await client.post(
        _match_url(bound_kb_id), json={"message": "我要申请退款"}
    )
    assert result.status_code == 200, result.text
    assert result.json()["matched"] is None


@pytest.mark.asyncio
async def test_match_endpoint_is_scoped_to_the_kb_it_is_called_on(
    client, bound_kb_id, unbound_kb_id, fake_qa_index, counting_embeddings
):
    """A pair on KB A is invisible to the tester for KB B."""
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/qa-items",
        json={"question": QUESTION, "answer": ANSWER, "keywords": ["退款"]},
    )
    assert created.status_code == 201, created.text

    other = await client.post(
        _match_url(unbound_kb_id), json={"message": "我要申请退款"}
    )
    assert other.status_code == 200, other.text
    assert other.json()["matched"] is None, "the tester must not leak across KBs"


@pytest.mark.asyncio
async def test_match_endpoint_404s_for_an_unknown_kb(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """Same guard as its siblings: an unknown/foreign KB is a 404, not an empty hit."""
    missing = await client.post(
        _match_url("kb-does-not-exist"), json={"message": "我要申请退款"}
    )
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Knowledge base not found"


@pytest.mark.asyncio
async def test_match_endpoint_rejects_an_empty_message(
    client, bound_kb_id, fake_qa_index, counting_embeddings
):
    rejected = await client.post(_match_url(bound_kb_id), json={"message": ""})
    assert rejected.status_code == 422, rejected.text


@pytest.mark.asyncio
async def test_match_endpoint_is_admin_only(
    support_client, bound_kb_id, fake_qa_index, counting_embeddings
):
    """`support` can triage sessions but cannot read the Q&A library."""
    denied = await support_client.post(
        _match_url(bound_kb_id), json={"message": "我要申请退款"}
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["detail"] == "Insufficient permissions"
