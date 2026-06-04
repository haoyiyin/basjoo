# Implementation Plan: Fix File Upload Index Status Display

**Status:** draft
**Date:** 2026-06-04
**Source:** User bug report — file upload on Files page succeeds but index status always shows "Not Established"
**Goal:** Fix UI to correctly report file indexing status and vector index establishment
**Architecture:** FastAPI backend + Next.js 14 frontend, Qdrant vector DB, multi-tenant KB document pipeline
**Tech Stack:** Python/FastAPI, TypeScript/React, Qdrant, PostgreSQL

## Planning Notes

### Patterns
- Backend follows thin-router pattern: `backend/api/v1/endpoints.py` delegates to services; DB logic must stay in services
- Multi-tenant isolation: all queries must include `tenant_id` filter
- KB document pipeline: `KbDocument` (new) replaces `KnowledgeFile` (deprecated)
- Frontend uses centralized API service (`src/services/api.ts`) with i18n strings in `src/locales/`

### Constraints
- Must not break existing URL-only indexing workflow
- Must support both zero-file and zero-url scenarios (index can be established by either)
- Must query through `Agent.kb_id → KnowledgeBase.id → KbDocument.kb_id` join (tenant-scoped)

### Assumptions
- The `files:upload` endpoint already correctly processes files through the KB document pipeline (parse → chunk → embed → Qdrant upsert) — this is confirmed working
- Chat RAG retrieval already works with uploaded files (uses same Qdrant data)
- `agent.kb_id` is reliably set after first file upload (via `KbService.get_or_create_agent_kb()`)

### Non-Blocking Questions
- Should `index:rebuild` also handle files? (Decided: scope to display fix only; rebuild fix is a separate feature)

---

## Exploration Summary

### Memory Files
- `AGENTS.md` — project conventions, architecture boundaries, KB document pipeline docs
- `README.md` — project overview

### Model
- kimi-2.5

### Subagents
1. **Find "flies" in frontend** — identified "flies" = typo for "Files" (File Upload Management view). Routes: `/files`, `/agents/[agentId]/files`. View: `FileUploadManagement.tsx`.
2. **KB document upload backend** — full backend pipeline: upload → KbDocument(pending) → background parse/chunk/embed/Qdrant → ready. 9 endpoints, 10 failure points.
3. **Frontend upload flow** — UI flow, API calls, polling, KBSetupGuard, Dashboard status indicator.
4. **Legacy file upload endpoint** — identified root cause mismatch. File upload uses new KbDocument pipeline and Qdrant successfully, but Dashboard queries old KnowledgeFile table.

### Key Files
| Path | Role |
|---|---|
| `backend/api/v1/endpoints.py` | `sources:summary` (line 2605), `index:info` (line 3498), `files:upload` (line 3050) |
| `backend/models.py` | `KnowledgeFile` (line 258, deprecated), `KbDocument` (line 563, active), `Agent.kb_id` (line 193) |
| `backend/services/kb_document_processor.py` | File processing pipeline (working correctly) |
| `backend/services/kb_service.py` | `get_or_create_agent_kb()` (line ~100) |
| `frontend-nextjs/src/views/Dashboard.tsx` | Vector Index Status indicator (line 538) |
| `frontend-nextjs/src/services/api.ts` | `getSourcesSummary()`, `getIndexInfo()` |
| `frontend-nextjs/src/views/FileUploadManagement.tsx` | File upload UI |

### Root Cause Findings

The file upload pipeline WORKS correctly — files are parsed, chunked, embedded, and upserted into Qdrant. The bug is purely in the **display layer**:

#### Bug A: `sources:summary` queries wrong table
**File:** `backend/api/v1/endpoints.py`, line ~2605
**Symptom:** `files.total` and `files.ready` always return 0
**Cause:** Queries deprecated `KnowledgeFile` table (linked by `agent_id`), but new pipeline writes to `KbDocument` table (linked by `kb_id` through `Agent.kb_id → KnowledgeBase → KbDocument.kb_id`)
**Fix:** Replace `KnowledgeFile` query with join through `Agent.kb_id → KnowledgeBase → KbDocument`

#### Bug B: Dashboard "Established" check ignores files
**File:** `frontend-nextjs/src/views/Dashboard.tsx`, line ~538
**Symptom:** "Vector Index Status" always shows "Not Established" even after successful file indexing
**Cause:** Condition checks only `sourcesSummary.urls.indexed > 0` (URL-only), completely ignoring file indexing status
**Fix:** Check `sourcesSummary.files.ready > 0` in addition to URL count

#### Bug C: `index:info` ignores files
**File:** `backend/api/v1/endpoints.py`, line ~3498
**Symptom:** `urls_indexed` field only counts URL sources
**Cause:** Only counts `URLSource.is_indexed == True`
**Fix:** Add `files_ready` count from `KbDocument` through same join

### Debugging Findings

| Field | Value |
|---|---|
| Symptom | After uploading files, Dashboard shows "Index Status: Not Established" and file counts show 0 despite successful upload |
| Reproduction | 1. Login as admin 2. Navigate to Files page 3. Upload a PDF 4. Wait for processing (status goes to "ready") 5. Go to Dashboard — shows "Not Established" |
| Root Cause | Two bugs: backend queries deprecated `KnowledgeFile` table (always empty), frontend only checks URL indexing for "Established" status |
| Fix | Backend: query `KbDocument` through `Agent.kb_id` join; Frontend: check both files and URLs for "Established" |
| Verification | Upload file → check Dashboard shows "Established" → check file counts are non-zero |
| Confidence | High — root cause confirmed by code inspection across all four exploration subagents |

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| **Modify** | `backend/api/v1/endpoints.py` | Fix `sources:summary` (line ~2605) + `index:info` (line ~3498) to query KbDocument |
| **Modify** | `frontend-nextjs/src/views/Dashboard.tsx` | Fix "Established" indicator (line ~538) to check both files and URLs |
| **Modify** | `frontend-nextjs/src/services/api.ts` | Update `SourcesSummary` and `IndexInfo` TypeScript interfaces if needed |
| **Modify** | `frontend-nextjs/src/locales/en-US/common.json` | Add any new i18n strings if needed |
| **Modify** | `frontend-nextjs/src/locales/zh-CN/common.json` | Add any new i18n strings if needed |
| **Test** | `backend/tests/test_sources_summary.py` | Test sources:summary returns correct file counts |
| **Test** | `backend/tests/test_index_info.py` | Test index:info includes file counts |

---

## Parallelization Strategy

### Execution Model: single-agent sequential

Three tightly coupled changes (backend endpoint → frontend display) must be verified together. Simple scope, single agent.

### Batch Table

| Batch | Tasks | Dependencies |
|---|---|---|
| 1 | Backend: fix sources:summary + index:info | None |
| 2 | Frontend: fix Dashboard indicator + API types + i18n | Batch 1 |
| 3 | Tests + verification | Batch 1, 2 |

---

## Verification Commands

| Command | Expected Result |
|---|---|
| `cd backend && pytest tests/test_sources_summary.py -v` | All tests pass |
| `cd backend && pytest tests/test_index_info.py -v` | All tests pass |
| `cd frontend-nextjs && npm run typecheck` | No errors |
| `cd frontend-nextjs && npm run build` | Build succeeds |
| `cd frontend-nextjs && npm run test` | All tests pass |

### Manual E2E verification
1. Start dev environment: `docker compose --profile dev up -d`
2. Login as `admin@admin.com / adminadmin`
3. Navigate to `/agents/{agentId}/files`
4. Upload a PDF file
5. Wait for status to show "Ready"
6. Navigate to Dashboard → verify "Vector Index Status: Established" (green dot)
7. Verify file counts in Sources Summary are non-zero

---

## Tasks

### Task 1: Fix `sources:summary` backend endpoint

**Purpose:** Query `KbDocument` instead of deprecated `KnowledgeFile` so file counts are correct

**File Scope:**
- `backend/api/v1/endpoints.py` — lines 2561-2650 (sources:summary function)
- `backend/models.py` — reference `KbDocument`, `KnowledgeBase`, `Agent` models

**Context:** The current query at ~line 2605 uses `select(func.count()).select_from(KnowledgeFile).where(KnowledgeFile.agent_id == agent_id)`. This table is never written to by the new pipeline. Must replace with join: `Agent.kb_id → KnowledgeBase.id → KbDocument.kb_id` with tenant filter.

**RED (failing test):**
1. Write `backend/tests/test_sources_summary.py`
2. Create test agent with KB, add KbDocument records (status=ready and status=error)
3. Call `GET /api/v1/sources:summary?agent_id={agent_id}`
4. Assert `response.files.total > 0` and `response.files.ready` matches ready count
5. Assert `response.files.total_size` sums correctly

**GREEN (minimal implementation):**
1. In `sources:summary` endpoint, replace `KnowledgeFile` query block (~lines 2605-2625) with:
   - Query `Agent` to get `kb_id`
   - If `kb_id` is None, return zeros
   - Query `KbDocument` filtered by `kb_id` and `tenant_id`
   - Count total, count ready (status="ready"), sum file_size

**REFACTOR (optional):**
- Consider extracting file stats query into a helper function in `kb_service.py` if it's reusable

**Commit Command:** `git commit -m "fix(backend): sources:summary queries KbDocument instead of deprecated KnowledgeFile"`

---

### Task 2: Fix `index:info` backend endpoint

**Purpose:** Include file document counts in index:info response so frontend can display accurate index status

**File Scope:**
- `backend/api/v1/endpoints.py` — lines 3498-3527 (index:info function)
- `backend/models.py`

**Context:** Current `index:info` only counts `URLSource.is_indexed == True`. Need to add `files_indexed` count from `KbDocument.status == "ready"` through the `Agent.kb_id → KnowledgeBase → KbDocument` path.

**RED (failing test):**
1. Write `backend/tests/test_index_info.py`
2. Create test agent with KB and KbDocument records
3. Call `GET /api/v1/index:info?agent_id={agent_id}`
4. Assert response includes `files_indexed` field with correct count

**GREEN (minimal implementation):**
1. After the existing `urls_indexed` query block, add a `KbDocument` query:
   - Get agent's `kb_id`
   - Count `KbDocument` where `kb_id == agent.kb_id` and `status == "ready"` and `tenant_id == agent.tenant_id`
2. Add `files_indexed` to response dict

**REFACTOR (optional):**
- None — simple addition

**Commit Command:** `git commit -m "fix(backend): index:info includes file document counts"`

---

### Task 3: Fix Dashboard "Established" indicator

**Purpose:** Dashboard shows "Established" when EITHER files or URLs are indexed

**File Scope:**
- `frontend-nextjs/src/views/Dashboard.tsx` — line ~538

**Context:** Current condition: `sourcesSummary && sourcesSummary.urls.indexed > 0`. After Task 1 fix, `sourcesSummary.files.ready` will have correct counts. Need to check both.

**RED (failing test):**
1. Write/modify Dashboard test to verify the condition
2. Mock `sourcesSummary` with `files.ready > 0` and `urls.indexed === 0`
3. Assert indicator shows "Established"

**GREEN (minimal implementation):**
1. Change condition to: `(sourcesSummary?.urls.indexed ?? 0) > 0 || (sourcesSummary?.files.ready ?? 0) > 0`
2. Verify i18n keys `status.established` and `status.notEstablished` exist in locale files

**REFACTOR:**
- None

**Commit Command:** `git commit -m "fix(frontend): Dashboard shows Established when files or URLs indexed"`

---

### Task 4: Update TypeScript types and i18n

**Purpose:** Ensure API response types match new backend response shapes

**File Scope:**
- `frontend-nextjs/src/services/api.ts`
- `frontend-nextjs/src/locales/en-US/common.json`
- `frontend-nextjs/src/locales/zh-CN/common.json`

**Context:** After Task 2, `index:info` returns new field `files_indexed`. TypeScript interfaces should reflect this. Also verify i18n strings for Dashboard status labels exist.

**RED:**
- TypeScript build should pass with updated types

**GREEN:**
1. Update `SourcesSummary` interface if `files.total_size` is newly populated
2. Update `IndexInfo` interface to include `files_indexed: number`
3. Verify i18n keys in locale files

**Commit Command:** `git commit -m "fix(frontend): update types and i18n for file index status"`

---

### Task 5: Integration verification

**Purpose:** Full build + test pass verification

**File Scope:** N/A (verification only)

**Steps:**
1. Run `cd backend && pytest -v` — all tests pass
2. Run `cd frontend-nextjs && npm run typecheck` — no errors
3. Run `cd frontend-nextjs && npm run build` — build succeeds
4. Run `cd frontend-nextjs && npm run test` — all tests pass

**Commit Command:** No separate commit (verification step)
