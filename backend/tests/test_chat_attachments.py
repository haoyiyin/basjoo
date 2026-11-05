"""#71 — visitor attachments: the upload contract and the prompt block.

Three guarantees are asserted here, all on data rather than on a model call:

* an uploaded document's text reaches the **assembled `messages` array** as a
  labelled untrusted block, positioned BELOW the retrieved chunks and ABOVE the
  raw user message — so a document can never be read as the knowledge base or as
  the question itself;
* the caps are readable rejections, never a silent drop: a sixth file and a
  file over 5 MB both answer a 4xx with a sentence;
* an attachment is prompt material only — it creates no `KbDocument` and no
  `KbChunk`, so uploading a file to a chat can never pollute the knowledge base.

The read-back route is scoped to the owning session, so a foreign id answers the
same 404 as a missing one.
"""

import pytest
from sqlalchemy import func, select

import database
from models import ChatAttachment, KbChunk, KbDocument
from services import attachment_service

ATTACHMENT_TEXT = "ATTACHMENT_SECRET_BODY: the invoice number is INV-90210."
KB_CHUNK_TEXT = "KB_CHUNK_MARKER: refunds are accepted within 30 days."

@pytest.fixture(autouse=True)
def attachments_root(tmp_path, monkeypatch):
    """Keep every upload in the test's own directory, never in /app/data."""
    root = tmp_path / "chat_attachments"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(attachment_service, "ATTACHMENTS_ROOT", root)
    return root

@pytest.fixture()
def captured_prompts(monkeypatch):
    """Record every `messages` array handed to the LLM service.

    Patched at `api.v1.endpoints.get_llm_service` — the seam the chat endpoints
    call — so the captured array is exactly the one `prepare_chat_request`
    assembled, after every prompt layer composed.
    """
    from services.llm_service import MockLLMService

    captured = []

    class CapturingLLM(MockLLMService):
        def __init__(self, *args, **kwargs):
            super().__init__(model=kwargs.get("model") or "mock-model")

        async def chat_completion(self, messages=None, **kwargs):
            captured.append(messages)
            async for chunk in super().chat_completion(messages=messages, **kwargs):
                yield chunk

    monkeypatch.setattr("api.v1.endpoints.get_llm_service", lambda *a, **k: CapturingLLM(*a, **k))
    return captured

@pytest.fixture()
def kb_chunks(monkeypatch):
    """A fixed retrieval result, so chunk placement is deterministic."""

    class FakeRetriever:
        async def retrieve(self, **kwargs):
            return [
                {
                    "text": KB_CHUNK_TEXT,
                    "doc_id": "doc_1",
                    "chunk_index": 0,
                    "score": 0.91,
                    "filename": "refund.txt",
                    "source_type": "file",
                    "source_url": "",
                    "source_title": "refund.txt",
                }
            ]

    monkeypatch.setattr("api.v1.endpoints.KbRetrievalService", FakeRetriever)

async def _upload(public_client, agent_id, *, name="notes.txt", content=b"hello", visitor_id="visitor-att", session_id=None):
    params = {"agent_id": agent_id, "visitor_id": visitor_id}
    if session_id:
        params["session_id"] = session_id
    return await public_client.post(
        "/api/v1/chat/attachments",
        params=params,
        files={"file": (name, content, "application/octet-stream")},
    )

def _system_content(messages) -> str:
    system = [m for m in messages if m.get("role") == "system"]
    assert system, "the assembled array must carry a system message"
    return system[-1]["content"]

# ------------------------------------------------------ the assembled prompt

@pytest.mark.asyncio(loop_scope="function")
async def test_attachment_text_lands_below_chunks_and_inside_the_untrusted_wrapper(
    public_client, default_agent_id, captured_prompts, kb_chunks
):
    """The core assertion: placement and labelling, on the assembled array."""
    uploaded = await _upload(
        public_client,
        default_agent_id,
        name="invoice.txt",
        content=ATTACHMENT_TEXT.encode("utf-8"),
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["status"] == "parsed", body
    assert body["kind"] == "document"
    assert body["filename"] == "invoice.txt"
    # The parsed text is prompt material and never part of the client payload.
    assert "text_content" not in body

    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "What is my invoice number?",
            "visitor_id": "visitor-att",
            "session_id": body["session_id"],
            "attachment_ids": [body["id"]],
        },
    )
    assert response.status_code == 200, response.text
    assert captured_prompts, "the chat path must have called the LLM"

    messages = captured_prompts[-1]
    content = _system_content(messages)

    assert ATTACHMENT_TEXT in content, "the attachment text must reach the prompt"
    assert KB_CHUNK_TEXT in content, "the pairing guard: retrieval still happened"

    # Below the retrieved chunks...
    assert content.index(KB_CHUNK_TEXT) < content.index(ATTACHMENT_TEXT)
    # ...and the raw user message stays its own array entry, after the system
    # block that carries the attachment — so a document is never mistaken for
    # the question itself.
    user_turns = [m for m in messages if m.get("role") == "user"]
    assert user_turns[-1]["content"] == "What is my invoice number?"
    assert messages.index({"role": "system", "content": content}) < messages.index(
        user_turns[-1]
    )

    # Inside the labelled untrusted wrapper, with the filename naming the source.
    header_index = content.index(attachment_service.ATTACHMENT_BLOCK_HEADER)
    assert header_index < content.index(ATTACHMENT_TEXT)
    assert "[附件: invoice.txt]" in content

@pytest.mark.asyncio(loop_scope="function")
async def test_attachment_injection_is_capped_and_says_so(
    public_client, default_agent_id, captured_prompts, kb_chunks
):
    """Total injected characters are capped, and the block admits the omission."""
    oversized = ("A" * 12000) + "TAIL_MARKER_SHOULD_NOT_APPEAR"
    uploaded = await _upload(
        public_client, default_agent_id, name="big.txt", content=oversized.encode("utf-8")
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()

    response = await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": default_agent_id,
            "message": "Summarize the file",
            "visitor_id": "visitor-att",
            "session_id": body["session_id"],
            "attachment_ids": [body["id"]],
        },
    )
    assert response.status_code == 200, response.text

    content = _system_content(captured_prompts[-1])
    block_start = content.index(attachment_service.ATTACHMENT_BLOCK_HEADER)
    injected = content[block_start:]
    assert len(injected) <= (
        attachment_service.MAX_ATTACHMENT_PROMPT_CHARS + 600
    ), "the injected block must stay near the cap"
    assert attachment_service.ATTACHMENT_OMITTED_NOTE in content
    assert "TAIL_MARKER_SHOULD_NOT_APPEAR" not in content

# --------------------------------------------------------------- the caps

@pytest.mark.asyncio(loop_scope="function")
async def test_sixth_file_is_rejected_with_a_readable_4xx(public_client, default_agent_id):
    """Five files land; the sixth answers a sentence, not a silent drop."""
    session_id = None
    for index in range(5):
        response = await _upload(
            public_client,
            default_agent_id,
            name=f"doc{index}.txt",
            content=f"body {index}".encode("utf-8"),
            visitor_id="visitor-six",
            session_id=session_id,
        )
        assert response.status_code == 200, response.text
        session_id = response.json()["session_id"]

    sixth = await _upload(
        public_client,
        default_agent_id,
        name="doc5.txt",
        content=b"body 5",
        visitor_id="visitor-six",
        session_id=session_id,
    )
    assert sixth.status_code == 400, sixth.text
    assert "5 files" in sixth.json()["detail"]

@pytest.mark.asyncio(loop_scope="function")
async def test_file_over_five_megabytes_is_rejected(public_client, default_agent_id):
    """Over-size is a readable 413, and nothing is stored."""
    before = await _attachment_count()
    oversized = b"x" * (5 * 1024 * 1024 + 1)
    response = await _upload(
        public_client, default_agent_id, name="huge.txt", content=oversized, visitor_id="visitor-big"
    )
    assert response.status_code == 413, response.text
    assert "5MB" in response.json()["detail"]
    assert await _attachment_count() == before

@pytest.mark.asyncio(loop_scope="function")
async def test_disallowed_type_is_rejected(public_client, default_agent_id):
    response = await _upload(
        public_client, default_agent_id, name="payload.exe", content=b"MZ", visitor_id="visitor-exe"
    )
    assert response.status_code == 400, response.text
    assert "Unsupported file type" in response.json()["detail"]

# ------------------------------------------------- no knowledge-base side effects

@pytest.mark.asyncio(loop_scope="function")
async def test_attachment_creates_no_kb_document_or_chunk(public_client, default_agent_id):
    """An attachment is prompt material, never an ingested document."""
    async with database.AsyncSessionLocal() as db:
        docs_before = int(await db.scalar(select(func.count(KbDocument.id))) or 0)
        chunks_before = int(await db.scalar(select(func.count(KbChunk.id))) or 0)

    response = await _upload(
        public_client,
        default_agent_id,
        name="kb-free.txt",
        content=ATTACHMENT_TEXT.encode("utf-8"),
        visitor_id="visitor-kbfree",
    )
    assert response.status_code == 200, response.text

    async with database.AsyncSessionLocal() as db:
        assert int(await db.scalar(select(func.count(KbDocument.id))) or 0) == docs_before
        assert int(await db.scalar(select(func.count(KbChunk.id))) or 0) == chunks_before

# ------------------------------------------------------------- read-back scope

@pytest.mark.asyncio(loop_scope="function")
async def test_attachment_read_back_is_scoped_to_the_owner(public_client, default_agent_id):
    """The owner reads it; a stranger gets the same 404 as a missing id."""
    uploaded = await _upload(
        public_client, default_agent_id, name="mine.txt", content=b"mine", visitor_id="visitor-owner"
    )
    assert uploaded.status_code == 200, uploaded.text
    attachment_id = uploaded.json()["id"]

    owned = await public_client.get(
        f"/api/v1/chat/attachments/{attachment_id}", params={"visitor_id": "visitor-owner"}
    )
    assert owned.status_code == 200, owned.text
    assert owned.json()["id"] == attachment_id

    foreign = await public_client.get(
        f"/api/v1/chat/attachments/{attachment_id}", params={"visitor_id": "visitor-stranger"}
    )
    missing = await public_client.get(
        "/api/v1/chat/attachments/does-not-exist", params={"visitor_id": "visitor-owner"}
    )
    assert foreign.status_code == 404, foreign.text
    assert missing.status_code == 404, missing.text
    assert foreign.json()["detail"] == missing.json()["detail"]

# ------------------------------------------------------------------ helpers

async def _attachment_count() -> int:
    async with database.AsyncSessionLocal() as db:
        return int(await db.scalar(select(func.count(ChatAttachment.id))) or 0)
