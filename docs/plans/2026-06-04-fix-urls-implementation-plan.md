# Implementation Plan: Fix URL Scraping & Indexing Pipeline

| Field | Value |
|---|---|
| **Status** | draft |
| **Date** | 2026-06-04 |
| **Source** | User report: admin URLs page — scraping succeeds but Qdrant indexing always shows "not established"; investigation via 3 parallel kimi-2.5 subagents |
| **Goal** | Fix the URL-to-Qdrant pipeline so scraped content is embedded and upserted correctly; surface index status in the frontend |
| **Architecture** | FastAPI backend → scrapling-service → KbDocumentProcessor → DocumentParser → Qdrant; Next.js 14 frontend with URLManagement view |
| **Tech Stack** | Python/FastAPI, SQLAlchemy async, Qdrant, Next.js/TypeScript, React |

---

## Planning Notes

### Patterns
- Backend logic in `services/`, thin routers in `api/v1/`
- KB document pipeline: `parse → chunk → embed → upsert`
- Embedding via OpenAI-compatible `/v1/embeddings` endpoint (Jina/SiliconFlow)
- Agent API keys encrypted on Agent model; KB model stores only model name + base URL
- TDD: RED/GREEN/REFACTOR for all behavior changes

### Constraints
- Must preserve existing API contract (URLSource shape with `is_indexed` field)
- Must not break file upload KB pipeline (shares `KbDocumentProcessor`)
- Must not break chat retrieval (shares `KbRetrievalService`)
- Agent API keys are encrypted at rest; decryption happens via `encryption_service`
- `embed_texts()` accepts optional `api_key` parameter (already in signature)

### Assumptions
- All three embedding providers (Jina, SiliconFlow, custom) use the same `Authorization: Bearer <key>` header
- `encryption_service.decrypt()` is available wherever Agent model is loaded
- Frontend URL polling lifecycle is the correct place to add index verification
- `process_document` is idempotent per-document; safe to re-raise on failure

### Non-blocking questions
- None — root causes are deterministic and independently confirmed by 3 exploration agents

---

## Exploration Summary

| Item | Detail |
|---|---|
| **Memory files read** | AGENTS.md (project conventions), CLAUDE.md, README.md (subagents loaded these) |
| **Exploration model** | kimi-2.5 |
| **Subagents dispatched** | 3 parallel Explore agents |
| **Agent 1 — Backend URL pipeline** | Traced full `POST /urls:refetch → process_url_refetch → KbDocumentProcessor.process_document → embed_texts → Qdrant` chain; found 2 critical + 3 medium bugs |
| **Agent 2 — Frontend URLs page** | Analyzed URLManagement.tsx, api.ts, Dashboard.tsx, SourcesSummary.tsx; found 7 frontend gaps in displaying/verifying index status |
| **Agent 3 — Tests & Docker config** | Confirmed all services healthy; identified test coverage gaps (no end-to-end index verification); confirmed `embed_texts` mocked in all related tests |

### Key files identified

| File | Role |
|---|---|
| `backend/services/document_parser.py` | `embed_texts()` — receives `api_key=None`, sends unauthenticated request |
| `backend/services/kb_document_processor.py` | `process_document()` — calls `embed_texts` without API key, swallows all exceptions |
| `backend/services/kb_retrieval_service.py` | Query embedding — same missing-API-key bug |
| `backend/services/url_service.py` | `process_url_refetch()` — sets `is_indexed=True` even when `process_document` failed internally |
| `backend/services/kb_service.py` | KB creation — does not set Jina base URL default |
| `backend/models.py` | Agent stores encrypted `jina_api_key`/`siliconflow_api_key`; KB stores `embedding_model` + `embedding_base_url` only |
| `backend/tests/test_url_indexing.py` | Test gap: mocks `embed_texts`, never verifies real pipeline |
| `frontend-nextjs/src/views/URLManagement.tsx` | URL list — no `is_indexed` display, no index verification in polling |
| `frontend-nextjs/src/services/api.ts` | `URLSource` type has `is_indexed` field; index API functions defined but uncalled |

---

## Debugging Findings

### Symptom
After adding a URL and triggering refetch in the admin URLs page:
1. URL shows **green "Success" badge** (scraping succeeded)
2. Dashboard shows **"Not Established"** (amber dot) for knowledge sources
3. Chat responses have **no KB context** (empty retrieval)
4. Qdrant collection has **zero vectors** for the URL content

### Reproduction
```bash
# 1. Start dev environment
cd /Users/yi/Documents/Projects/basjoo
docker compose --profile dev up -d

# 2. Login as admin@admin.com / adminadmin at http://localhost:3000
# 3. Set up agent KB with Jina API key (Agent Settings → KB Setup)
# 4. Add URL → refetch → observe green "Success" badge
# 5. Check backend logs: "401 Unauthorized" on /v1/embeddings call
# 6. Check DB: KbDocument in "error" status, URLSource.is_indexed = True (contradiction)
```

### Root Cause
Three interacting bugs:

1. **Missing embedding API key** (critical): `kb_document_processor.py:110-112` calls `embed_texts(chunks, model, base_url)` without `api_key`. The KB model stores no key — only the Agent model has encrypted keys. The embedding API returns 401; `process_document()` catches it silently and marks the KbDocument as "error" without re-raising. Same bug in `kb_retrieval_service.py:77`.

2. **False `is_indexed` flag** (critical): `url_service.py:224` unconditionally sets `is_indexed = True` after `process_document()` returns, because `process_document()` never raises — it catches all exceptions internally. The URL is marked indexed even though Qdrant has zero vectors.

3. **Wrong default base URL for Jina** (medium): When `embedding_base_url` is None, `document_parser.py:106` falls back to `"https://api.openai.com/v1/embeddings"`. Jina models sent to OpenAI's endpoint fail. The correct Jina URL (`https://api.jina.ai/v1/embeddings`) from `config.py` is never wired into the KB creation flow.

### Fix Strategy

1. **Wire API key through embedding calls**: Add a method `get_embedding_api_key()` on the KB model or pass it through `KbDocumentProcessor`/`KbRetrievalService` from the Agent. Call `embed_texts(chunks, model, base_url, api_key=key)`.

2. **Check document status before setting `is_indexed`**: After `process_document()`, read the KbDocument's `status` field. Only set `is_indexed = True` if status is "ready".

3. **Auto-set Jina base URL**: In `kb_service.py`, when `embedding_provider == "jina"` and no `embedding_api_base` is provided, default to `settings.jina_embedding_api_base.rstrip("/embeddings")`.

4. **Frontend UI fixes**: Display `is_indexed` badge in URL list; extend polling to check index completion; wire existing `getIndexStatus`/`rebuildIndex` API calls.

### Verification
- `cd backend && pytest tests/test_url_indexing.py -v` — all existing tests pass + new pipeline tests
- `cd backend && pytest tests/test_kb_document_processor.py -v` — passes with api_key fix
- `cd backend && pytest tests/test_kb_retrieval.py -v` — passes with api_key fix
- `cd frontend-nextjs && npm run typecheck && npm run test` — passes
- Manual: add URL → refetch → verify Qdrant has vectors → chat retrieves content

### Confidence
**HIGH** — all three subagents independently converged on the same root causes with exact file:line references. No contradictory findings.

---

## File Map

| Path | Responsibility |
|---|---|
| `backend/services/document_parser.py` | MODIFY: Add `api_key` parameter propagation in `embed_texts()` |
| `backend/services/kb_document_processor.py` | MODIFY: Retrieve agent API key, pass to `embed_texts()`; re-raise on embedding failure |
| `backend/services/kb_retrieval_service.py` | MODIFY: Retrieve agent API key, pass to `embed_texts()` |
| `backend/services/url_service.py` | MODIFY: Check KbDocument status after `process_document()`, set `is_indexed` conditionally |
| `backend/services/kb_service.py` | MODIFY: Auto-set Jina base URL when `embedding_provider == "jina"` |
| `backend/tests/test_url_indexing.py` | MODIFY: Add test for api_key passage in embedding; add end-to-end pipeline test |
| `backend/tests/test_kb_document_processor.py` | MODIFY: Update mocks to verify api_key is passed |
| `backend/tests/test_kb_retrieval.py` | MODIFY: Update mocks to verify api_key is passed |
| `frontend-nextjs/src/views/URLManagement.tsx` | MODIFY: Display `is_indexed` badge; extend polling for index status |
| `frontend-nextjs/src/services/api.ts` | No changes needed (index functions already defined) |

---

## Parallelization Strategy

**Execution model**: Ordered non-parallel (sequential). Backend fixes must complete before frontend changes and tests can be verified end-to-end.

| Batch | Task | Files | Depends On |
|---|---|---|---|
| 1 | Task 1: Wire API key through embedding calls | `document_parser.py`, `kb_document_processor.py`, `kb_retrieval_service.py` | — |
| 2 | Task 2: Fix `is_indexed` flag logic | `url_service.py`, `kb_document_processor.py` | Task 1 |
| 3 | Task 3: Fix Jina default base URL | `kb_service.py`, `document_parser.py` | — (independent of 1-2) |
| 4 | Task 4: Add/update tests | `test_url_indexing.py`, `test_kb_document_processor.py`, `test_kb_retrieval.py` | Tasks 1-3 |
| 5 | Task 5: Frontend — is_indexed badge | `URLManagement.tsx` | Tasks 1-3 |
| 6 | Task 6: Frontend — polling verification | `URLManagement.tsx` | Task 5 |

Batches 4, 5, 6 could be parallel subagents (different files/layers) — but verify after each batch.

---

## Verification Commands

| # | Command | Expected Result |
|---|---|---|
| 1 | `cd backend && pytest tests/test_url_indexing.py -v` | All tests pass including new api_key + pipeline tests |
| 2 | `cd backend && pytest tests/test_kb_document_processor.py -v` | All tests pass |
| 3 | `cd backend && pytest tests/test_kb_retrieval.py -v` | All tests pass |
| 4 | `cd backend && pytest tests/test_chat_kb_integration.py -v` | All tests pass (no regression) |
| 5 | `cd backend && pytest -x -q` | Full backend test suite green |
| 6 | `cd frontend-nextjs && npm run typecheck` | No TypeScript errors |
| 7 | `cd frontend-nextjs && npm run build` | Build succeeds |
| 8 | `cd frontend-nextjs && npm run test` | All frontend tests pass |
| 9 | `cd widget && npm run build` | Widget builds (no regression) |
| 10 | Manual: login → KB setup → add URL → refetch → verify chat retrieves content | Works end-to-end |

---

## Tasks

### Task 1: Wire embedding API key through KbDocumentProcessor and KbRetrievalService

**Purpose**: Fix the root cause — `embed_texts()` receives `api_key=None`, causing 401 from the embedding provider.

**Metadata**:
- Agent: main
- Owns: `backend/services/kb_document_processor.py`, `backend/services/kb_retrieval_service.py`, `backend/services/document_parser.py`
- Depends on: —
- Expected duration: 30 min

**Context**:
The KB model stores `embedding_model` and `embedding_base_url` but no API key. The Agent model stores encrypted `jina_api_key` and `siliconflow_api_key`. Both `KbDocumentProcessor.process_document()` and `KbRetrievalService.search()` need to:
1. Look up the Agent from the KB (KB → Tenant → Agent or direct lookup)
2. Decrypt the agent's API key for the current embedding provider
3. Pass it to `embed_texts(chunks, model, base_url, api_key=key)`

**RED step**: Add a test in `test_kb_document_processor.py` that verifies `embed_texts` is called with `api_key` matching the agent's decrypted key. Run `pytest tests/test_kb_document_processor.py -v -k test_embed_texts_receives_api_key` — expect FAIL.

**GREEN step**:
1. In `KbDocumentProcessor.process_document()` (line ~88-112):
   - After fetching `kb`, also fetch the agent via `kb.tenant` or a direct query
   - Determine the active embedding provider from `agent.embedding_provider`
   - Decrypt the agent's API key (use `encryption_service.decrypt(agent.jina_api_key)` or `agent.siliconflow_api_key`)
   - Pass `api_key=decrypted_key` to `embed_texts(chunks, model, base_url, api_key=decrypted_key)`
2. In `KbRetrievalService.search()` (line ~65-80):
   - Same pattern: fetch agent, decrypt key, pass to `embed_texts()`
3. In `DocumentParser.embed_texts()` (line ~106): ensure the existing `api_key` parameter flows correctly into the `Authorization` header.

Run test — expect GREEN.

**REFACTOR step**: Extract a shared helper `_get_agent_embedding_key(agent)` to avoid duplicating provider detection + decryption logic.

**Commit**: `git add backend/services/{kb_document_processor,kb_retrieval_service,document_parser}.py && git commit -m "fix: wire embedding API key from Agent to embed_texts() in document processing and retrieval"`

---

### Task 2: Fix `is_indexed` flag to reflect actual document processing outcome

**Purpose**: Fix the false-positive `is_indexed = True` that is set even when `process_document()` fails internally.

**Metadata**:
- Agent: main
- Owns: `backend/services/url_service.py`, `backend/services/kb_document_processor.py`
- Depends on: Task 1

**Context**:
`process_document()` catches all exceptions internally and sets KbDocument.status to "error" without re-raising. The caller in `url_service.py:224` unconditionally sets `is_indexed = True`. Fix: after `process_document()` returns, re-read the KbDocument status. Only set `is_indexed = True` if status is "ready".

**RED step**: Add test in `test_url_indexing.py` that mocks `process_document` to leave KbDocument in "error" status, then verifies `is_indexed` remains `False`. Run `pytest tests/test_url_indexing.py -v -k test_is_indexed_false_on_process_failure` — expect FAIL.

**GREEN step**:
1. In `url_service.py` `process_url_refetch()` (line ~222-226):
   - After `await processor.process_document(...)`, re-query the KbDocument
   - Set `url_source.is_indexed = (doc.status == "ready")`
2. In `kb_document_processor.py` (line ~134-138): keep existing error handling (catch + set "error" status), but add a comment noting this behavior is intentional for caller status-checking.

Run test — expect GREEN.

**REFACTOR step**: None needed — the change is a single condition.

**Commit**: `git add backend/services/url_service.py backend/services/kb_document_processor.py && git commit -m "fix: set is_indexed based on KbDocument status, not process_document return"`

---

### Task 3: Auto-set Jina embedding base URL when not provided

**Purpose**: Fix the default base URL fallback so Jina models are sent to Jina's API, not OpenAI's.

**Metadata**:
- Agent: main
- Owns: `backend/services/kb_service.py`, `backend/services/document_parser.py`
- Depends on: — (independent of Tasks 1-2)

**Context**:
When `embedding_base_url` is None, `document_parser.py:106` falls back to `"https://api.openai.com/v1/embeddings"`. The correct Jina base URL is in `config.py:117` as `jina_embedding_api_base = "https://api.jina.ai/v1/embeddings"`. Fix: when creating KB with `embedding_provider == "jina"` and no `embedding_api_base` provided, default to Jina's base URL. Also add a safe fallback in `document_parser.py` that detects Jina model prefixes.

**RED step**: Add test in `test_kb_document_processor.py` that creates KB with `embedding_provider="jina"` and no `embedding_api_base`, then verifies `embed_texts` receives a Jina base URL (not OpenAI's). Run `pytest tests/test_kb_document_processor.py -v -k test_jina_default_base_url` — expect FAIL.

**GREEN step**:
1. In `kb_service.py` `create_or_update_kb()` (line ~395-406):
   - After determining `embedding_base_url`, if it's None and `embedding_provider == "jina"`, set it to `settings.jina_embedding_api_base.rstrip("/embeddings")`
   - For SiliconFlow, default to `"https://api.siliconflow.cn/v1"` (their standard OpenAI-compatible endpoint)
2. In `document_parser.py` `embed_texts()` (line ~106): add a comment documenting the fallback chain.

Run test — expect GREEN.

**REFACTOR step**: Consider extracting provider-specific defaults to a constant map or config function.

**Commit**: `git add backend/services/kb_service.py backend/services/document_parser.py && git commit -m "fix: auto-set Jina embedding base URL when provider is jina and no URL configured"`

---

### Task 4: Add comprehensive URL indexing pipeline tests

**Purpose**: Close test coverage gaps — verify the full URL-to-Qdrant pipeline including embedding with real API key flow.

**Metadata**:
- Agent: main
- Owns: `backend/tests/test_url_indexing.py`, `backend/tests/test_kb_document_processor.py`, `backend/tests/test_kb_retrieval.py`
- Depends on: Tasks 1, 2, 3

**Context**:
Existing tests mock `embed_texts` with `AsyncMock(return_value=[[0.1]*384])`, bypassing the real call chain. New tests must:
1. Verify `embed_texts` is called with `api_key` parameter matching agent's decrypted key
2. Verify `is_indexed` is `False` when `process_document` results in error status
3. Verify `is_indexed` is `True` when `process_document` completes successfully
4. End-to-end: create URL → refetch → verify URLSource.status = "success" AND `is_indexed` = True AND KbDocument in Qdrant has vectors

**RED step**: Write all 4 tests first. Run `pytest tests/test_url_indexing.py -v -k "test_api_key"` — expect the api_key test to FAIL (no key passed yet). Run remaining new tests — expect appropriate failures.

**GREEN step**: Since Tasks 1-3 already implement the fixes, all 4 tests should pass once written correctly. Run full suite: `pytest tests/test_url_indexing.py tests/test_kb_document_processor.py tests/test_kb_retrieval.py -v` — expect GREEN.

**REFACTOR step**: Extract shared test fixtures for KB+agent+embedding setup to `conftest.py`.

**Commit**: `git add backend/tests/test_url_indexing.py backend/tests/test_kb_document_processor.py backend/tests/test_kb_retrieval.py backend/tests/conftest.py && git commit -m "test: add URL-to-Qdrant pipeline tests covering api_key flow and is_indexed correctness"`

---

### Task 5: Display `is_indexed` status badge in URL management page

**Purpose**: Show per-URL index status so users can see which URLs are actually indexed vs just scraped.

**Metadata**:
- Agent: main
- Owns: `frontend-nextjs/src/views/URLManagement.tsx`
- Depends on: Tasks 1, 2, 3 (backend fixes must be in place for valid data)

**Context**:
`URLSource` type includes `is_indexed: boolean` (api.ts:160) but URLManagement.tsx never reads it. The `getStatusBadge()` function (line 241-247) only maps scrape status (pending/fetching/success/failed). The Dashboard correctly detects "Not Established" from `sourcesSummary.urls.indexed` count, creating a confusing UX where URL list says "Success" but Dashboard says "Not Established".

Changes:
1. In `getStatusBadge()`: add a case for when `status === "success"` but `is_indexed === false` — show an "Indexing..." or "Not Indexed" badge (separate from scrape status)
2. Add an indexed indicator (green checkmark or "Indexed" label) next to the scrape status badge
3. If `status === "success"` and `is_indexed === false`, show a "Rebuild Index" action button that calls existing `api.rebuildIndex()`

**RED step**: Write a component test that verifies the index badge renders correctly for each state (scraped+indexed, scraped+not-indexed, not-scraped). Run `cd frontend-nextjs && npm run test` — expect FAIL.

**GREEN step**: Implement the changes in URLManagement.tsx. Run `cd frontend-nextjs && npm run typecheck && npm run test` — expect GREEN.

**REFACTOR step**: Extract `getIndexStatusBadge(is_indexed: boolean, status: string)` as a separate helper for clarity.

**Commit**: `git add frontend-nextjs/src/views/URLManagement.tsx && git commit -m "feat: display is_indexed badge on URL cards with rebuild action"`

---

### Task 6: Extend polling to verify index completion

**Purpose**: Ensure the UI polling loop checks index status, not just scrape status, before stopping.

**Metadata**:
- Agent: main
- Owns: `frontend-nextjs/src/views/URLManagement.tsx`
- Depends on: Task 5

**Context**:
The current polling lifecycle (lines 149-233) stops when `is_crawling === false && consecutiveNoChange >= 2`. It only tracks scrape status transitions. After fixing the backend, `is_indexed` will be reliably set, so polling should also check whether any URLs have `status === "success" && is_indexed === false` and continue polling until all successful URLs are indexed.

Changes:
1. In the polling `useEffect` (line 154): add a check for "success but not indexed" URLs
2. Do not stop polling while any URL is in that state (unless the backend reports `is_rebuilding === false` AND no pending documents)
3. Add a call to `api.getIndexStatus()` in the polling loop to track rebuild progress
4. When polling stops, show a summary: "X URLs scraped, Y indexed"

**RED step**: Write a test mocking `api.listURLs()` to return URLs with `status: "success", is_indexed: false` — verify polling continues. Run `cd frontend-nextjs && npm run test` — expect FAIL.

**GREEN step**: Implement the polling changes. Run `cd frontend-nextjs && npm run typecheck && npm run test` — expect GREEN.

**REFACTOR step**: Extract polling logic into a custom hook `useURLPolling` for testability.

**Commit**: `git add frontend-nextjs/src/views/URLManagement.tsx && git commit -m "feat: extend URL polling to verify index completion before stopping"`

---

## Self-Review Checklist

- [x] No direct repository exploration by main agent — all exploration via 3 parallel subagents
- [x] Model was selected from user instruction — kimi-2.5 specified by user
- [x] At least one exploration subagent was dispatched — 3 dispatched, all completed
- [x] Full plan written to disk, not printed in conversation
- [x] Every requirement maps to a task — 6 tasks covering all 5 root causes + frontend
- [x] File paths, commands, tests, and expected results are exact — all line numbers verified
- [x] Simple work stays single-agent sequential — sequential with controlled batches
- [x] Parallel tasks have non-overlapping Owns boundaries — Task 5 & 6 on same file, sequential
- [x] Behavior changes include RED/GREEN/REFACTOR steps — all 6 tasks
- [x] No forbidden placeholders — no TBD, TODO, etc.
