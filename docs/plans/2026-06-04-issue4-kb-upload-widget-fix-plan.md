# Issue 4 KB Upload, URL Indexing, and Widget Verification Implementation Plan

**Status:** Draft
**Date:** 2026-06-04
**Source:** GitHub issue #4, `https://github.com/haoyiyin/basjoo/issues/4`, title `使用系统中遇到几个问题`
**Goal:** Verify and fix the confirmed Issue #4 knowledge-base URL indexing and file-upload failures, and add a gated reproduction path for the unconfirmed widget popup report.
**Architecture:** The confirmed KB failures come from a split between legacy agent-scoped URL/file endpoints and the newer tenant-scoped KnowledgeBase/Qdrant document pipeline used by chat retrieval. The repair should keep existing admin UI flows stable while ensuring every agent has a bound tenant KB, URL/file ingestion reaches the same parse/chunk/embed/upsert path, and chat retrieval passes tenant and threshold parameters correctly. The widget report is not proven by static code and existing E2E coverage, so it must begin with a reproduction test before any widget implementation change.
**Tech Stack:** FastAPI, SQLAlchemy, tenant-scoped KB services, Qdrant, Redis/background tasks, Next.js 14 App Router, React/TypeScript, Vitest/Jest frontend tests, Pytest backend tests, Playwright E2E.

## Planning Notes

- Exploration model: `kimi-2.5`, selected by the user.
- Exploration was performed by three subagents:
  - Code/root-cause verification for GitHub issue #4.
  - Tests/reproduction verification, which found local `BUG-004` but not the GitHub issue.
  - Focused disambiguation confirming GitHub issue #4 is the authoritative source for the user wording.
- GitHub Issue #4 contains three bug reports and one feature request:
  1. Website KB pages can be added, but vector indexing remains unestablished and Playground does not answer from KB.
  2. KB file upload always fails.
  3. Widget embed code is added to a website, but no popup appears.
  4. Feature request: subaccounts should be limited to one specific agent.
- The local `BUG-004` plan about Playground input accessibility is unrelated to GitHub Issue #4.
- The subaccount request is already partially implemented through `AgentMember` access control and agent-scoped admin member UI. It should not be part of the bugfix scope unless the product owner requests UX enhancements.
- This plan is for repair and verification only. It should not redesign the KB system or remove legacy endpoints that the current UI still calls.

## Exploration Summary

### Confirmed: Website URL KB indexing remains unestablished and Playground ignores KB

Evidence from exploration:

- `backend/api/v1/endpoints.py` has `/api/v1/urls:create` creating `URLSource` rows with `status="pending"` but no fetch, parse, embed, Qdrant upsert, or `is_indexed=True` transition.
- `backend/api/v1/endpoints.py` summary code counts `URLSource.is_indexed == True`, but exploration found no writer that sets the field true.
- `frontend-nextjs/src/services/api.ts` calls URL/index endpoints such as `/api/v1/urls:refetch`, `/api/v1/urls:crawl_site`, `/api/v1/urls:discover`, `/api/v1/index:rebuild`, `/api/v1/index:status`, and `/api/v1/index:info`, while the backend lacks matching routes.
- `frontend-nextjs/src/services/api.ts` expects a `createURLs()` shape with `{ created, message }`, while backend `/api/v1/urls:create` returns a `URLListResponse` shape with `{ urls, total, quota }`.
- Chat retrieval in `backend/api/v1/endpoints.py` only runs KB retrieval when `agent.kb_id` exists.
- Agent creation and KB setup do not reliably create and bind a tenant-scoped `KnowledgeBase` to `agent.kb_id`.
- `backend/services/kb_retrieval_service.py` can be called with `tenant_id=None`; it then rejects tenant-owned KBs because `kb.tenant_id != tenant_id`.
- Retrieval defaults use a high threshold around `0.6`, while project guidance says RRF scores are commonly `0.01–0.05` and frontend sliders map to `0.00–0.10`.

### Confirmed as a functional ingestion failure: KB file upload does not produce retrievable KB content

Evidence from exploration:

- `frontend-nextjs/src/views/FileUploadManagement.tsx` calls `api.uploadFiles(agentId, selectedFiles)`.
- `frontend-nextjs/src/services/api.ts` posts file uploads to legacy `/api/v1/files:upload`.
- `backend/api/v1/endpoints.py` legacy file upload creates `KnowledgeFile` rows with `status="pending"` but does not store file bytes, parse content, chunk, embed, or upsert to Qdrant.
- The real tenant KB document processing endpoint exists in `backend/api/v1/kb_document_endpoints.py` as `/api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents`.
- `backend/services/kb_document_processor.py` owns the actual parse/chunk/embed/upsert path.
- Current frontend file upload does not reach the tenant KB document processor.

Clarification: a raw HTTP response from `/api/v1/files:upload` may be successful, but the end-to-end KB upload behavior is broken because files do not become indexed or retrievable.

### Not confirmed by code: Widget embed popup does not appear

Evidence from exploration:

- `frontend-nextjs/src/lib/widgetEmbedCode.ts` generates embed code using `/sdk.js?agent_id=...`.
- `backend/main.py` serves `/sdk.js` from backend static assets.
- `widget/src/BasjooWidget.tsx` bootstraps from script parameters, supports `agentId` and `agent_id`, waits for DOM readiness, and creates the widget container, button, and chat window.
- `tests/e2e/specs/widget-cross-origin.spec.ts` already verifies widget button/window rendering for an allowed host scenario.

Likely external causes not proven by static exploration:

- The generated embed origin is not reachable from the customer site.
- Customer site Content Security Policy blocks external scripts.
- A localhost or private-network embed code was copied to a public site.
- The script loads, but a runtime error occurs before bootstrap.
- Origin whitelist can block chat requests, but should not prevent the popup button itself from rendering.

## Debugging Findings

- Root cause confidence for URL indexing: high.
- Root cause confidence for functional file-upload failure: medium-high.
- Root cause confidence for widget popup: medium-low; the first implementation task must reproduce or falsify the issue under admin-generated embed conditions.
- Root cause pattern: legacy agent-scoped URL/FileSource flows are not connected to the newer tenant-scoped KB document and Qdrant pipeline, while chat retrieval depends on `agent.kb_id` and tenant-safe retrieval.
- Risk: fixing only frontend endpoint paths without binding agents to tenant KBs will still leave Playground unable to retrieve KB content.
- Risk: fixing only chat retrieval without processing URL/file uploads will still leave sources unindexed.
- Risk: changing widget embed behavior before reproduction may break a path already covered by existing E2E.

## File Map

### Backend files to modify or test

- `backend/api/v1/endpoints.py`
  - Thin legacy agent-scoped URL/file routes.
  - Chat request preparation and KB retrieval call site.
  - Agent creation, KB setup, URL source summary, missing URL/index route compatibility.
- `backend/api/v1/kb_document_endpoints.py`
  - Tenant KB document upload route and background processing integration.
- `backend/services/kb_service.py`
  - Agent-to-tenant-KB creation/binding helper or reuse of existing tenant KB lookup.
- `backend/services/kb_retrieval_service.py`
  - Tenant-safe retrieval signature, threshold behavior, and chat-call compatibility.
- `backend/services/kb_document_processor.py`
  - Shared parse/chunk/embed/upsert logic for file documents and URL-derived documents.
- `backend/services/url_service.py`
  - URL fetching/indexing orchestration if existing service boundaries already own it.
- `backend/services/url_safety.py`
  - Must be used for all URL fetch paths; do not bypass SSRF protection.
- `backend/models.py`
  - Read for `Agent`, `KnowledgeBase`, `KbDocument`, `KbChunk`, `URLSource`, `KnowledgeFile`, and `AgentMember` schema constraints.
- `backend/tests/`
  - Add focused API/service tests for agent KB binding, URL indexing state transitions, file upload processing, and retrieval parameters.

### Frontend files to modify or test

- `frontend-nextjs/src/services/api.ts`
  - Align URL, file, index status, and tenant KB document API shapes with backend.
- `frontend-nextjs/src/views/URLManagement.tsx`
  - Keep user-facing URL source workflow stable while showing accurate indexing state.
- `frontend-nextjs/src/views/FileUploadManagement.tsx`
  - Route uploads through the working KB document flow or a backend compatibility wrapper.
- `frontend-nextjs/src/components/KBSetupWizard.tsx`
  - Ensure setup creates or binds the agent KB before URL/file onboarding completes.
- `frontend-nextjs/src/components/KBSetupGuard.tsx`
  - Ensure completed setup reflects real KB readiness rather than only a boolean flag.
- `frontend-nextjs/src/lib/widgetEmbedCode.ts`
  - Only modify after widget reproduction proves admin-generated embed code is invalid or incomplete.
- `frontend-nextjs/src/views/AgentSettings.tsx`
  - Read if widget embed display or copy behavior is involved in reproduction.

### Widget files to modify or test only after reproduction

- `widget/src/BasjooWidget.tsx`
  - Bootstrap and popup rendering behavior.
- `backend/main.py`
  - Static `/sdk.js` serving and CORS/static asset exposure.
- `backend/static/sdk.js`
  - Generated artifact; do not edit directly. Sync from `widget/` build output when widget source changes.

### E2E and integration tests

- `tests/e2e/specs/knowledge-indexing.spec.ts`
  - URL indexing and Playground retrieval regression coverage.
- `tests/e2e/specs/playground-streaming.spec.ts`
  - Playground answer path after KB binding/retrieval fixes.
- `tests/e2e/specs/widget-cross-origin.spec.ts`
  - Widget embed rendering under generated-code and cross-origin conditions.
- `tests/e2e/fixtures/e2e-context.ts`
  - Read for setup helpers and tenant/agent creation flows.

## Parallelization Strategy

Execution model: ordered with limited fan-out after backend contract stabilization.

1. Task 1 must run first because URL/file ingestion and chat retrieval both need a reliable agent-to-tenant-KB binding contract.
2. Tasks 2 and 3 can run in parallel after Task 1 if implementers own non-overlapping backend/frontend slices and agree on the API contract in Task 1.
3. Task 4 should run after Tasks 1–3 because it validates Playground retrieval against indexed content.
4. Task 5 can run in parallel with Tasks 2–4 because widget reproduction is isolated from KB ingestion, but widget source must not be changed unless the reproduction test fails for an in-repo cause.
5. Task 6 runs last as fan-in verification across backend, frontend, widget, and E2E.

## Verification Commands

### Backend focused verification

```bash
cd /Users/yi/Documents/Projects/basjoo/backend
pytest tests/test_kb_agent_binding.py tests/test_url_indexing.py tests/test_file_upload_kb_ingestion.py tests/test_kb_retrieval.py
```

If the exact new test files are placed under existing test modules, run the affected modules instead of the four names above and record the actual command in the implementation summary.

### Backend broader verification

```bash
cd /Users/yi/Documents/Projects/basjoo/backend
pytest
```

### Frontend verification

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs
npm run build
npm run typecheck
npm run test
```

### Widget verification, only if widget source or generated embed behavior changes

```bash
cd /Users/yi/Documents/Projects/basjoo/widget
npm run build
npm run sync-widget
```

### E2E verification

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e -- tests/e2e/specs/knowledge-indexing.spec.ts
npm run test:e2e -- tests/e2e/specs/playground-streaming.spec.ts
npm run test:e2e -- tests/e2e/specs/widget-cross-origin.spec.ts
```

### Full smoke verification

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e
```

## Task 1: Establish agent-scoped tenant KB binding contract

**Purpose:** Ensure every agent that uses KB features has a tenant-scoped `KnowledgeBase` bound through `agent.kb_id`, and ensure chat retrieval receives the correct tenant and similarity threshold.

**Execution Metadata:** dependencies: none; parallelizable: no; batch: backend-contract; owns: `backend/api/v1/endpoints.py`, `backend/services/kb_service.py`, `backend/services/kb_retrieval_service.py`, backend tests for agent binding/retrieval; reads: `backend/models.py`, `backend/api/v1/kb_document_endpoints.py`, `backend/services/qdrant_service.py`; must-not-edit: frontend UI files, widget files, generated static SDK.

**Files:**

- Modify: `backend/api/v1/endpoints.py`
- Modify: `backend/services/kb_service.py`
- Modify: `backend/services/kb_retrieval_service.py`
- Test: `backend/tests/test_kb_agent_binding.py`
- Test: `backend/tests/test_kb_retrieval.py`

**Context for implementer:**

- Keep routers thin; put reusable binding logic in `backend/services/`.
- Add or reuse a helper that returns a tenant-scoped KB for an agent and creates/binds one when needed by KB setup, URL ingestion, file ingestion, or chat retrieval.
- Preserve multi-tenant isolation: every KB lookup must check tenant ownership through existing access helpers or service checks.
- Do not create global or shared KBs across tenants.
- Update `prepare_chat_request()` or its helper path so `KbRetrievalService.retrieve()` receives the authenticated tenant ID and agent similarity threshold.
- Use the project-documented similarity scale: frontend 0–100 maps to `0.00–0.10`, and typical RRF values are `0.01–0.05`.
- Preserve existing `kb_setup_completed` semantics, but make setup completion reflect a real agent KB binding.

- [ ] Step 1: Write failing backend tests proving a new or existing agent can be bound to a tenant KB, chat retrieval is called with the tenant ID, and the configured similarity threshold is used.
- [ ] Step 2: Run the focused tests and verify RED with the current implementation.
- [ ] Step 3: Implement the minimal service and router changes to create or bind the agent KB and pass tenant/threshold into retrieval.
- [ ] Step 4: Run the focused tests and verify GREEN.
- [ ] Step 5: Refactor service boundaries so routers remain thin and tenant checks remain centralized.
- [ ] Step 6: Run `cd backend && pytest tests/test_kb_agent_binding.py tests/test_kb_retrieval.py` or the actual affected backend test modules.
- [ ] Step 7: Commit with a conventional message such as `fix(kb): bind agents to tenant knowledge bases`.

## Task 2: Repair URL ingestion and index status for agent KB pages

**Purpose:** Make URL sources added from the admin UI progress from pending to indexed/error, upsert content into the agent's tenant KB/Qdrant collection, and report accurate index status to the UI.

**Execution Metadata:** dependencies: Task 1; parallelizable: yes with Task 3 after API contract agreement; batch: kb-ingestion; owns: URL ingestion backend routes/services and URL E2E tests; reads: frontend URL management code, URL safety service, Qdrant service; must-not-edit: file-upload UI and widget source.

**Files:**

- Modify: `backend/api/v1/endpoints.py`
- Modify: `backend/services/url_service.py`
- Modify: `backend/services/kb_document_processor.py` only if needed to support URL-derived text documents through the same ingestion primitive
- Modify: `frontend-nextjs/src/services/api.ts`
- Modify: `frontend-nextjs/src/views/URLManagement.tsx`
- Test: `backend/tests/test_url_indexing.py`
- Test: `tests/e2e/specs/knowledge-indexing.spec.ts`

**Context for implementer:**

- All outbound URL fetching must go through `backend/services/url_safety.py` and existing safe-fetch conventions.
- Prefer a backend compatibility wrapper that keeps current admin UI URL routes usable while internally routing successful fetches into the tenant KB pipeline.
- Implement only the frontend-called routes that are required by the current UI flow: URL creation, refetch, crawl/discover if visible in the UI, index rebuild, index status, and index info. Each route should delegate to services.
- Align `frontend-nextjs/src/services/api.ts` response parsing with the backend response shape. Either update the backend to return the UI contract or update the UI to consume the existing `URLListResponse`; do not leave mismatched fields.
- Status transitions must be visible to users: pending or processing, indexed, and error with a useful message.
- Task locking must protect duplicate indexing jobs for the same agent/source where existing TaskLock patterns apply.

- [ ] Step 1: Write failing backend and E2E tests proving a URL added for an agent is fetched, indexed into the bound tenant KB, marked indexed, and appears in index status.
- [ ] Step 2: Run the focused backend/E2E tests and verify RED.
- [ ] Step 3: Implement minimal URL service orchestration and route compatibility so URL content reaches Qdrant and `URLSource.is_indexed` reflects success.
- [ ] Step 4: Run focused tests and verify GREEN.
- [ ] Step 5: Refactor duplicate indexing/status code into services while preserving thin route handlers.
- [ ] Step 6: Run `cd backend && pytest tests/test_url_indexing.py` and `cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e -- tests/e2e/specs/knowledge-indexing.spec.ts`.
- [ ] Step 7: Commit with a conventional message such as `fix(kb): index agent url sources`.

## Task 3: Repair file upload by connecting UI flow to tenant KB document ingestion

**Purpose:** Ensure uploaded files are stored, parsed, chunked, embedded, upserted to Qdrant, and reflected in the UI as indexed or failed with a useful error.

**Execution Metadata:** dependencies: Task 1; parallelizable: yes with Task 2 after API contract agreement; batch: kb-ingestion; owns: file upload backend/frontend and file ingestion tests; reads: document parser, KB document endpoints, frontend upload view; must-not-edit: URL indexing UI except shared API types, widget source.

**Files:**

- Modify: `backend/api/v1/endpoints.py`
- Modify: `backend/api/v1/kb_document_endpoints.py` only if a small reusable service extraction is needed
- Modify: `backend/services/kb_document_processor.py`
- Modify: `frontend-nextjs/src/services/api.ts`
- Modify: `frontend-nextjs/src/views/FileUploadManagement.tsx`
- Modify: `frontend-nextjs/src/components/KBSetupWizard.tsx` if upload onboarding needs a bound KB ID
- Test: `backend/tests/test_file_upload_kb_ingestion.py`
- Test: E2E coverage in `tests/e2e/specs/knowledge-indexing.spec.ts` or a dedicated file-upload E2E spec

**Context for implementer:**

- The preferred ingestion path is `POST /api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents` and `KbDocumentProcessor`.
- Keep current UI affordances where possible: users upload files from the agent KB management page, not from a raw tenant/KB administration page.
- If retaining `/api/v1/files:upload` for compatibility, make it a thin wrapper that resolves the agent's tenant KB and calls the same document ingestion service as tenant KB uploads.
- Enforce existing file limits and accepted extensions: max 5 files, 20MB, txt/md/html/pdf/docx/xlsx.
- Preserve tenant isolation through `require_tenant_access` and `KbService.get_knowledge_base` or equivalent service checks.
- Surface per-file processing status and `error_message` from `kb_documents` or the compatibility status model.

- [ ] Step 1: Write failing backend tests proving the agent-scoped upload path stores bytes, creates `KbDocument` records, invokes processing, and transitions to ready or error.
- [ ] Step 2: Run focused backend tests and verify RED.
- [ ] Step 3: Implement minimal wrapper or frontend route migration so file uploads reach the tenant KB document processor.
- [ ] Step 4: Run focused backend/frontend tests and verify GREEN.
- [ ] Step 5: Refactor upload status mapping so the UI no longer reports success for unprocessed `KnowledgeFile` rows.
- [ ] Step 6: Run `cd backend && pytest tests/test_file_upload_kb_ingestion.py` and `cd frontend-nextjs && npm run test`.
- [ ] Step 7: Commit with a conventional message such as `fix(kb): process agent file uploads through tenant kb`.

## Task 4: Verify Playground answers from indexed KB content

**Purpose:** Prove that after URL or file ingestion completes, Playground chat retrieves agent KB context and produces an answer grounded in the uploaded or indexed content.

**Execution Metadata:** dependencies: Tasks 1, 2, and 3; parallelizable: no; batch: integration; owns: chat retrieval tests and E2E assertions; reads: Playground view, chat SSE endpoints, KB retrieval service; must-not-edit: widget source, unrelated admin views.

**Files:**

- Modify: `backend/api/v1/endpoints.py` only if chat request preparation still misses KB context after Tasks 1–3
- Modify: `backend/services/kb_retrieval_service.py` only if retrieval behavior still rejects valid tenant KBs or thresholds
- Modify: `tests/e2e/specs/playground-streaming.spec.ts`
- Modify: `tests/e2e/specs/knowledge-indexing.spec.ts`
- Test: backend chat/KbRetrieval tests if existing modules cover SSE context injection

**Context for implementer:**

- The success condition is not just `is_indexed=True`; Playground must receive retrievable KB context for the same tenant and agent.
- Use deterministic test content with a unique phrase so E2E can assert that the assistant response references the indexed KB rather than generic model knowledge.
- Where external LLM calls are hard to stabilize, assert the backend retrieval/context assembly layer in Pytest and keep E2E focused on the visible flow and request success.
- Do not weaken SSE behavior or error middleware to make tests pass.

- [ ] Step 1: Write failing tests proving Playground retrieval uses the bound agent KB after URL/file indexing and that tenant mismatches return no context.
- [ ] Step 2: Run focused backend/E2E tests and verify RED.
- [ ] Step 3: Implement minimal chat preparation or retrieval fixes that remain after Tasks 1–3.
- [ ] Step 4: Run focused tests and verify GREEN.
- [ ] Step 5: Refactor test helpers for deterministic KB content and avoid sleeps where status polling is available.
- [ ] Step 6: Run `cd backend && pytest tests/test_kb_retrieval.py` and `cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e -- tests/e2e/specs/playground-streaming.spec.ts`.
- [ ] Step 7: Commit with a conventional message such as `fix(chat): retrieve indexed agent kb context in playground`.

## Task 5: Reproduce and gate the widget popup report before changing widget code

**Purpose:** Determine whether admin-generated embed code fails to show the popup under an in-repo reproducible scenario, and fix only the proven in-repo cause.

**Execution Metadata:** dependencies: none; parallelizable: yes with KB tasks; batch: widget-diagnostics; owns: widget E2E reproduction and widget/embed fixes only after failing reproduction; reads: widget source, embed-code generator, static serving; must-not-edit: KB ingestion files.

**Files:**

- Modify: `tests/e2e/specs/widget-cross-origin.spec.ts`
- Modify after failing reproduction only: `frontend-nextjs/src/lib/widgetEmbedCode.ts`
- Modify after failing reproduction only: `widget/src/BasjooWidget.tsx`
- Modify after failing reproduction only: `backend/main.py`
- Generated after widget source change: `backend/static/sdk.js` through `npm run sync-widget`

**Context for implementer:**

- Existing static analysis suggests the widget should render the popup button when `/sdk.js?agent_id=...` loads successfully.
- Start by adding an E2E case that copies or reconstructs the same embed code generated by the admin UI and runs it on a cross-origin test page.
- Capture three separate outcomes in the test or debug logs: script request status, bootstrap execution, and popup DOM presence.
- Treat origin whitelist failures as chat-request failures, not popup-render failures, unless the bootstrap code explicitly blocks rendering based on origin.
- If the script URL uses localhost or an internal host in a public-site scenario, fix embed code generation or documentation to make the deployment base URL explicit.
- If customer CSP blocks scripts, document the required `script-src` and connection origins rather than changing widget bootstrap code.

- [ ] Step 1: Write a failing or diagnostic E2E test that uses admin-generated embed code on the cross-origin widget test page and asserts the widget popup button appears.
- [ ] Step 2: Run `cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e -- tests/e2e/specs/widget-cross-origin.spec.ts` and record whether the report is reproduced.
- [ ] Step 3: If the test reproduces an in-repo failure, implement the minimal embed-code, static serving, or widget bootstrap fix proven by the failure.
- [ ] Step 4: Run the focused widget E2E test and verify GREEN.
- [ ] Step 5: If widget source changed, run `cd widget && npm run build && npm run sync-widget` and verify generated `backend/static/sdk.js` is updated from source.
- [ ] Step 6: Run the widget E2E command again after sync and confirm no regression in existing cross-origin coverage.
- [ ] Step 7: Commit with a conventional message such as `test(widget): reproduce generated embed popup` for test-only confirmation or `fix(widget): render generated embed popup` for a proven product fix.

## Task 6: Fan-in verification, documentation, and issue closure evidence

**Purpose:** Prove the Issue #4 bugfix set is complete, document the verified outcomes, and prepare a concise issue response with what was fixed and what was not reproduced.

**Execution Metadata:** dependencies: Tasks 1–5; parallelizable: no; batch: final-verification; owns: verification notes and optional docs updates; reads: all modified files and test output; must-not-edit: unrelated generated reports, deployment secrets, production data.

**Files:**

- Modify only if behavior or setup changed: `README.md`
- Modify only if agent workflow or repo conventions changed: `AGENTS.md` or `CLAUDE.md`
- Create or update implementation evidence note only if the team wants a durable artifact: `docs/plans/2026-06-04-issue4-kb-upload-widget-fix-results.md`

**Context for implementer:**

- Do not claim the widget bug is fixed unless Task 5 reproduced and fixed an in-repo failure.
- Do claim the widget report is not reproduced if the generated-embed E2E passes and no in-repo failure is found.
- Include exact test commands and summarized output in the final issue response.
- Mention the subaccount request separately as already partially implemented or as a future enhancement outside this bugfix scope.

- [ ] Step 1: Run LSP diagnostics on modified backend/frontend files before build/test commands.
- [ ] Step 2: Run backend focused and full test commands.
- [ ] Step 3: Run frontend build, typecheck, and test commands.
- [ ] Step 4: Run widget build/sync only if widget source changed.
- [ ] Step 5: Run focused E2E specs for knowledge indexing, Playground streaming, and widget cross-origin.
- [ ] Step 6: Run full E2E smoke if the focused suite passes and the dev stack is healthy.
- [ ] Step 7: Commit with a conventional message such as `test(issue4): verify kb and widget regressions` or include verification notes in the final implementation commit.
