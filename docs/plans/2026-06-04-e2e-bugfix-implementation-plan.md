# E2E Bugfix Implementation Plan

**Status:** Draft
**Date:** 2026-06-04
**Source:** `User request: 制定一个详细的修复计划，subagent用kimi-2.5`; prior E2E evidence in `E2E_BUG_REPORT.md` and `E2E_RAW_OUTPUT.txt`
**Goal:** Fix the failing Basjoo E2E workflows by separating true application defects from test-contract mismatches and hardening the Playwright suite against known flake sources.
**Architecture:** Repair backend KB state recovery and KB retrieval at the service/API boundary, then align E2E assertions with the current chat and KB upload contracts. Harden frontend and widget behavior where browser/runtime conditions currently break tests, while keeping dedicated UI-auth coverage intact. Use focused RED/GREEN checks per defect before running the full smoke, widget, and prod-like suites.
**Tech Stack:** Python, FastAPI, SQLAlchemy, pytest, TypeScript, React, Next.js 14, widget TypeScript bundle, Playwright.

## Planning Notes

- Key existing patterns to follow: backend routers in `backend/api/` remain thin; backend logic belongs in `backend/services/`; frontend views/components stay under `frontend-nextjs/src/`; widget changes stay under `widget/src/`; widget bundle changes must be synchronized with `npm run sync-widget`.
- Constraints from codebase: E2E tests run sequentially with `workers: 1`; admin-auth specs must continue using true UI login; non-auth specs may use hardened helper behavior but must still validate user-visible outcomes.
- Important assumptions: the prior comprehensive test run is the reproduction baseline; provided DeepSeek and Jina keys are test credentials; the current source may already contain `data-testid="chat-message-input"`, so the selector task includes a regression check and rebuild path.
- Open questions that do not block starting: whether the public API should expose KB `tenant_id` through agent config; this plan avoids that product-contract change by using the existing agent-scoped upload endpoint in E2E.

## Exploration Summary

- Project memory reviewed by subagents: `AGENTS.md`, `CLAUDE.md`, `README.md`, `tests/README.md`, `E2E_BUG_REPORT.md`, `E2E_RAW_OUTPUT.txt`.
- Exploration subagent model used: `kimi-2.5`.
- Subagents dispatched: 3 concerns — backend KB/chat API, frontend/widget failures, Playwright test strategy.
- Key files explored: `backend/api/v1/endpoints.py`, `backend/services/kb_service.py`, `backend/services/kb_retrieval_service.py`, `backend/api/v1/kb_document_endpoints.py`, `backend/api/v1/schemas.py`, `frontend-nextjs/src/components/ChatPanel.tsx`, `frontend-nextjs/src/views/Playground.tsx`, `frontend-nextjs/src/context/AuthContext.tsx`, `frontend-nextjs/src/components/RequireAuth.tsx`, `widget/src/BasjooWidget.tsx`, `tests/e2e/fixtures/e2e-context.ts`, `tests/e2e/specs/playground-streaming.spec.ts`, `tests/e2e/specs/knowledge-indexing.spec.ts`, `tests/e2e/specs/widget-cross-origin.spec.ts`, `tests/e2e/playwright.config.ts`.
- Findings that shaped the plan:
  - `agent:kb-setup` likely fails to repair the inconsistent state `kb_setup_completed=true` with `kb_id=null`; normal first-run setup already binds `agent.kb_id`.
  - Chat E2E expects `message`, while the backend contract is `reply`; this is a test-contract mismatch.
  - KB retrieval is likely dropping context when chat calls retrieval with `tenant_id=None` before deriving the KB tenant.
  - Tenant KB document upload E2E uses `workspace_id` where the endpoint expects KB tenant id; the safer test path is the existing agent-scoped file upload endpoint.
  - Login failures are likely helper flakiness because admin-auth UI login specs pass; `adminLogin()` needs to await the login API response and token persistence.
  - Widget code needs safe storage fallback because direct `localStorage` access can throw in opaque or sandboxed cross-origin contexts.
  - The chat input selector may already be fixed in source; add a regression check and ensure tests run against rebuilt frontend assets.

## Debugging Findings

- Symptom: `knowledge-indexing.spec.ts:133` asserts `config.kb_id` but receives `null` after KB setup.
- Reproduction: `cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=prod-like tests/e2e/specs/knowledge-indexing.spec.ts --grep "agent with KB bound"`.
- Root Cause: most-likely backend state repair gap in `backend/api/v1/endpoints.py` when an agent is marked setup-complete without a valid `kb_id`; confidence medium.
- Fix Strategy: make `agent:kb-setup` reconcile invalid completed state by creating or rebinding an agent KB before returning a terminal response.
- Verification: add a backend regression test that seeds `kb_setup_completed=true, kb_id=null`, calls `agent:kb-setup`, and asserts a valid `kb_id`.
- Confidence: medium.

- Symptom: `playground-streaming.spec.ts:224` gets HTTP 200 but `chatData.message` is undefined.
- Reproduction: `cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "chat endpoint returns success"`.
- Root Cause: high-confidence E2E assertion mismatch because backend schema uses `reply`; likely service bug also exists where `KbRetrievalService.retrieve(tenant_id=None, ...)` rejects KBs before deriving `kb.tenant_id`.
- Fix Strategy: update E2E assertions to require `reply` and repair retrieval tenant derivation for chat callers.
- Verification: backend retrieval unit test plus focused Playwright chat API test.
- Confidence: high.

- Symptom: `playground-streaming.spec.ts:122` fails around document upload with tenant KB endpoint status mismatch.
- Reproduction: `cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "indexed content"`.
- Root Cause: high-confidence E2E route misuse because `workspace_id` is not the KB `tenant_id` required by `/api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents`.
- Fix Strategy: use `/api/v1/files:upload?agent_id=...` for agent-scoped E2E upload, matching the admin API service path.
- Verification: focused Playwright KB indexed-content test reaches ready/indexed state.
- Confidence: high.

- Symptom: `playground-streaming.spec.ts:24` and `:84` sometimes remain on `/login` after helper login.
- Reproduction: `cd /Users/yi/Documents/Projects/basjoo && npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "auto-save|clear chat"`.
- Root Cause: medium-confidence E2E helper race; the helper clicks submit then checks URL without explicitly awaiting login response and localStorage writes.
- Fix Strategy: wrap the submit click in `page.waitForResponse()` for `/api/admin/login`, assert status 200, wait for auth localStorage, then assert dashboard navigation.
- Verification: admin-auth specs still pass; playground specs no longer fail at login helper.
- Confidence: medium.

- Symptom: `widget-cross-origin.spec.ts:42` sees `scriptLoaded=true` but no widget container/button and page error `Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`
- Reproduction: `cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e:widget`.
- Root Cause: high-confidence widget application bug; direct `localStorage` access throws before widget initialization can create DOM.
- Fix Strategy: add a storage adapter in `widget/src/BasjooWidget.tsx` with try/catch and in-memory fallback for visitor/session storage.
- Verification: widget unit test with throwing localStorage plus `npm run test:e2e:widget`.
- Confidence: high.

- Symptom: `playground-streaming.spec.ts:60` and `:84` cannot find `data-testid="chat-message-input"`.
- Reproduction: `cd /Users/yi/Documents/Projects/basjoo && npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "send message|clear chat"`.
- Root Cause: medium-confidence stale served frontend or already-fixed selector because current source reportedly has the test id in `ChatPanel.tsx`.
- Fix Strategy: assert the test id in frontend component tests, rebuild frontend containers before E2E, and add the attribute if absent on the target branch.
- Verification: component test and focused Playwright tests locate the input.
- Confidence: medium.

## File Map

- Create: `backend/tests/test_kb_setup_repair.py` — regression coverage for completed agents missing `kb_id`.
- Create: `backend/tests/test_kb_retrieval_tenant_derivation.py` — regression coverage for `tenant_id=None` retrieval deriving the KB tenant.
- Create: `widget/src/BasjooWidget.storage.test.tsx` — widget storage-denied fallback coverage.
- Modify: `backend/api/v1/endpoints.py` — repair `agent:kb-setup` inconsistent state handling; keep router thin by delegating service logic where possible.
- Modify: `backend/services/kb_service.py` — add or reuse helper for validating/rebinding an agent KB when `kb_id` is missing or stale.
- Modify: `backend/services/kb_retrieval_service.py` — derive tenant id from KB before tenant mismatch checks when caller passes `tenant_id=None`.
- Modify: `tests/e2e/fixtures/e2e-context.ts` — harden `adminLogin()` response/token/navigation waits and diagnostics.
- Modify: `tests/e2e/specs/playground-streaming.spec.ts` — use backend `reply` contract; use agent-scoped file upload; reject failed KB setup before asserting downstream invariants.
- Modify: `tests/e2e/specs/knowledge-indexing.spec.ts` — require successful KB setup or explicit repair response before asserting `kb_id`.
- Modify: `frontend-nextjs/src/components/ChatPanel.tsx` — ensure the visible playground chat input has `data-testid="chat-message-input"`.
- Modify: `frontend-nextjs/src/views/Playground.tsx` — only if the test id is owned by a view-level input on the target branch.
- Modify: `widget/src/BasjooWidget.tsx` — add safe storage adapter and replace direct `localStorage` calls.
- Modify: `backend/static/sdk.js` — synchronized generated widget bundle after `npm run sync-widget`.
- Test: `backend/tests/test_kb_agent_binding.py` — extend if existing fixtures cover setup binding more cleanly than the new file.
- Test: `backend/tests/test_kb_retrieval.py` — extend if existing fixtures cover tenant derivation more cleanly than the new file.
- Create/Test: `frontend-nextjs/src/components/__tests__/ChatPanel.test.tsx` — selector regression coverage for the playground chat input.
- Docs: `E2E_BUG_REPORT.md` — update only after fixes are verified, recording resolved bug IDs and verification output.

## Parallelization Strategy

Preferred execution model: `fan-out/fan-in`

| Batch | Tasks | Can Run in Parallel? | Reason |
|---|---|---|---|
| 1 | Task 1, Task 2, Task 4, Task 5 | yes | Backend KB, E2E helper, widget storage, and frontend selector changes own disjoint source files. |
| 2 | Task 3 | no | E2E chat/KB spec alignment depends on backend contract decisions from Task 1. |
| 3 | Task 6 | no | Full verification depends on all fixes and synchronized widget bundle. |

## Verification Commands

```bash
cd /Users/yi/Documents/Projects/basjoo/backend && pytest tests/test_kb_setup_repair.py tests/test_kb_retrieval_tenant_derivation.py
cd /Users/yi/Documents/Projects/basjoo/backend && pytest tests/test_kb_agent_binding.py tests/test_kb_retrieval.py
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs && npm run build && npm run typecheck && npm run test
cd /Users/yi/Documents/Projects/basjoo/widget && npm run build && npm run test
cd /Users/yi/Documents/Projects/basjoo && npm run sync-widget
cd /Users/yi/Documents/Projects/basjoo && npm run typecheck:e2e
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e
cd /Users/yi/Documents/Projects/basjoo && HOST_ALLOWED_URL=http://allowed.local:8080 HOST_BLOCKED_URL=http://blocked.local:8081 API_BASE_URL=http://localhost:8000 npm run test:e2e:widget
cd /Users/yi/Documents/Projects/basjoo && docker compose --profile prod up -d --build backend-prod frontend-prod nginx
cd /Users/yi/Documents/Projects/basjoo && E2E_ENV=prod API_BASE_URL=http://localhost E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e:prod
```

Expected: all commands pass with no new warnings or errors.

---

### Task 1: Repair backend KB setup and retrieval contracts

**Purpose:** Ensure agents always have a valid `kb_id` after KB setup and chat retrieval can use KB context when callers omit tenant id.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `backend/api/v1/endpoints.py`
  - `backend/services/kb_service.py`
  - `backend/services/kb_retrieval_service.py`
  - `backend/tests/test_kb_setup_repair.py`
  - `backend/tests/test_kb_retrieval_tenant_derivation.py`
- Reads:
  - `backend/models.py`
  - `backend/api/v1/schemas.py`
  - `backend/tests/test_kb_agent_binding.py`
  - `backend/tests/test_kb_retrieval.py`
- Must not edit:
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/fixtures/e2e-context.ts`
  - `widget/src/BasjooWidget.tsx`

**Files:**
- Create/Test: `backend/tests/test_kb_setup_repair.py`
- Create/Test: `backend/tests/test_kb_retrieval_tenant_derivation.py`
- Modify: `backend/api/v1/endpoints.py`
- Modify: `backend/services/kb_service.py`
- Modify: `backend/services/kb_retrieval_service.py`

**Context for implementer:**
- Follow `backend/services/` service-first architecture and keep `backend/api/v1/endpoints.py` route logic thin.
- The normal setup path in `KbService.get_or_create_agent_kb()` reportedly binds `agent.kb_id`; preserve that behavior.
- The repair path must handle `agent.kb_setup_completed is True` with `agent.kb_id is None` or a stale KB reference.
- `KbRetrievalService.retrieve()` must derive `tenant_id` from the loaded KB before rejecting a tenant mismatch when the caller passes `tenant_id=None`.

- [ ] **Step 1: Write the failing test**

Add `backend/tests/test_kb_setup_repair.py` with assertions for:
- an agent seeded with `kb_setup_completed=True` and `kb_id=None` receives a valid KB after calling the setup route or service;
- the returned payload includes the bound `kb_id`;
- a second setup call returns the same KB id and does not create a duplicate active KB.

Add `backend/tests/test_kb_retrieval_tenant_derivation.py` with assertions for:
- retrieval called with `tenant_id=None` and a valid `kb_id` does not reject the KB because of tenant mismatch;
- retrieval called with an explicit wrong tenant id still rejects the KB;
- retrieval called with the correct tenant id preserves existing behavior.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd /Users/yi/Documents/Projects/basjoo/backend && pytest tests/test_kb_setup_repair.py tests/test_kb_retrieval_tenant_derivation.py
```

Expected: FAIL because inconsistent setup state remains unrepaired and `tenant_id=None` retrieval rejects KB context.

- [ ] **Step 3: Implement the minimal code**

Modify `backend/services/kb_service.py`:
- add a helper that validates `agent.kb_id` points to an existing KB;
- when setup is marked complete but `kb_id` is absent or stale, call the existing get-or-create binding flow and persist the agent update;
- return the repaired KB configuration without creating duplicate KBs on repeated calls.

Modify `backend/api/v1/endpoints.py`:
- replace route-level short-circuit behavior with the service helper;
- only return a terminal conflict when setup is complete and the existing KB is valid.

Modify `backend/services/kb_retrieval_service.py`:
- load KB first;
- if caller `tenant_id` is `None`, set effective tenant id to `kb.tenant_id`;
- compare explicit tenant ids against `kb.tenant_id` after derivation.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
cd /Users/yi/Documents/Projects/basjoo/backend && pytest tests/test_kb_setup_repair.py tests/test_kb_retrieval_tenant_derivation.py
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Keep the repair helper named around agent KB reconciliation, avoid duplicating KB creation logic, and keep route code limited to request/response orchestration.

- [ ] **Step 6: Run relevant broader verification**

```bash
cd /Users/yi/Documents/Projects/basjoo/backend && pytest tests/test_kb_agent_binding.py tests/test_kb_retrieval.py
```

Expected: PASS with no regression in existing KB binding and retrieval tests.

- [ ] **Step 7: Commit**

```bash
git add backend/api/v1/endpoints.py backend/services/kb_service.py backend/services/kb_retrieval_service.py backend/tests/test_kb_setup_repair.py backend/tests/test_kb_retrieval_tenant_derivation.py
git commit -m "fix: repair agent kb setup state"
```

---

### Task 2: Harden Playwright admin login helper

**Purpose:** Remove login-helper race conditions while preserving dedicated UI login coverage.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `tests/e2e/fixtures/e2e-context.ts`
- Reads:
  - `tests/e2e/specs/admin-auth.spec.ts`
  - `frontend-nextjs/src/views/Login.tsx`
  - `frontend-nextjs/src/context/AuthContext.tsx`
  - `frontend-nextjs/src/components/RequireAuth.tsx`
- Must not edit:
  - `backend/api/v1/endpoints.py`
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `widget/src/BasjooWidget.tsx`

**Files:**
- Modify/Test: `tests/e2e/fixtures/e2e-context.ts`

**Context for implementer:**
- Keep `admin-auth.spec.ts` as true UI login coverage.
- Improve helper diagnostics so future auth failures show login response status, response body, and visible login error text.
- Do not hide real auth regressions by bypassing UI login for admin-auth specs.

- [ ] **Step 1: Write the failing test**

Modify `tests/e2e/fixtures/e2e-context.ts` helper-level behavior by adding assertions in the existing helper path for:
- the `/api/admin/login` response is observed during submit;
- response status is 200;
- `localStorage` contains the expected auth token/admin state before URL assertion.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd /Users/yi/Documents/Projects/basjoo && npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "auto-save shows saving/saved state|clear chat resets conversation"
```

Expected: FAIL or expose current flaky timing/diagnostic gap if the helper checks URL before auth state is durable.

- [ ] **Step 3: Implement the minimal code**

Modify `tests/e2e/fixtures/e2e-context.ts`:
- wrap submit click with `page.waitForResponse()` matching `/api/admin/login`;
- assert response status 200 and include response text in failure output;
- wait for `localStorage` token/admin values with `page.waitForFunction()`;
- wait for navigation away from `/login` after token persistence;
- collect visible login error text when the page remains on `/login`.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
cd /Users/yi/Documents/Projects/basjoo && npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "auto-save shows saving/saved state|clear chat resets conversation"
```

Expected: PASS through login setup or fail with actionable API/auth diagnostics.

- [ ] **Step 5: Refactor while staying green**

Keep the helper readable by extracting only local utilities for login-response matching and localStorage polling.

- [ ] **Step 6: Run relevant broader verification**

```bash
cd /Users/yi/Documents/Projects/basjoo && npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/admin-auth.spec.ts
cd /Users/yi/Documents/Projects/basjoo && npm run typecheck:e2e
```

Expected: PASS; UI auth coverage remains intact.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/fixtures/e2e-context.ts
git commit -m "test: harden e2e admin login helper"
```

---

### Task 3: Align Playwright chat and KB specs with API contracts

**Purpose:** Make E2E chat/KB tests assert the current backend contract and use the correct agent-scoped KB upload path.

**Execution Metadata:**
- Dependencies: `Task 1`
- Parallelizable: `no`
- Batch: `2`
- Owns:
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
- Reads:
  - `backend/api/v1/schemas.py`
  - `backend/api/v1/endpoints.py`
  - `frontend-nextjs/src/services/api.ts`
  - `tests/e2e/fixtures/e2e-context.ts`
- Must not edit:
  - `backend/services/kb_service.py`
  - `backend/services/kb_retrieval_service.py`
  - `widget/src/BasjooWidget.tsx`

**Files:**
- Modify/Test: `tests/e2e/specs/playground-streaming.spec.ts`
- Modify/Test: `tests/e2e/specs/knowledge-indexing.spec.ts`

**Context for implementer:**
- Backend chat response contract is `reply`, not `message`.
- Agent-scoped upload should use `/api/v1/files:upload?agent_id=...` rather than direct tenant KB upload with `workspace_id`.
- If a setup response is `400` or `409`, tests must verify a valid existing `kb_id` before continuing; do not accept a terminal setup error and then assert downstream state without checking repair.

- [ ] **Step 1: Write the failing test**

Modify `tests/e2e/specs/playground-streaming.spec.ts` and `tests/e2e/specs/knowledge-indexing.spec.ts` to assert:
- chat API response includes non-empty `reply`;
- chat API response includes `session_id` when the schema promises it;
- KB setup path either succeeds or returns a valid existing `kb_id` before upload/chat steps continue;
- KB upload uses `/api/v1/files:upload?agent_id=<agent id>` and accepts only documented success statuses.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "chat endpoint returns success|indexed content"
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=prod-like tests/e2e/specs/knowledge-indexing.spec.ts --grep "agent with KB bound"
```

Expected: FAIL before Task 1 is applied or before spec alignment is complete for documented contract mismatch reasons.

- [ ] **Step 3: Implement the minimal code**

Modify `tests/e2e/specs/playground-streaming.spec.ts`:
- replace `chatData.message` assertions with `chatData.reply` assertions;
- assert `session_id` only according to the current response schema;
- replace direct tenant document upload using `workspace_id` with `/api/v1/files:upload?agent_id=...`;
- use `E2E_JINA_API_KEY` from environment and avoid hardcoded fake Jina values for indexing paths that require real embeddings.

Modify `tests/e2e/specs/knowledge-indexing.spec.ts`:
- require successful setup or repaired existing setup before asserting `kb_id`;
- make failure output include setup status and response body;
- keep assertions focused on user-visible KB/chat behavior.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "chat endpoint returns success|indexed content"
cd /Users/yi/Documents/Projects/basjoo && E2E_ENV=prod API_BASE_URL=http://localhost E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=prod-like tests/e2e/specs/knowledge-indexing.spec.ts --grep "agent with KB bound"
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Extract only local helper functions for chat response assertion and KB setup validation if they reduce repeated response-body diagnostics.

- [ ] **Step 6: Run relevant broader verification**

```bash
cd /Users/yi/Documents/Projects/basjoo && npm run typecheck:e2e
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts tests/e2e/specs/knowledge-indexing.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/specs/playground-streaming.spec.ts tests/e2e/specs/knowledge-indexing.spec.ts
git commit -m "test: align e2e chat kb contracts"
```

---

### Task 4: Add widget safe storage fallback

**Purpose:** Ensure the widget renders even when `window.localStorage` access throws in cross-origin, sandboxed, or opaque-origin contexts.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `widget/src/BasjooWidget.tsx`
  - `widget/src/BasjooWidget.storage.test.tsx`
  - `backend/static/sdk.js`
- Reads:
  - `tests/e2e/specs/widget-cross-origin.spec.ts`
  - `scripts/sync-widget.sh`
  - `widget/package.json`
- Must not edit:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `backend/api/v1/endpoints.py`
  - `tests/e2e/specs/playground-streaming.spec.ts`

**Files:**
- Modify: `widget/src/BasjooWidget.tsx`
- Create/Test: `widget/src/BasjooWidget.storage.test.tsx`
- Modify/Generated: `backend/static/sdk.js`

**Context for implementer:**
- The widget currently fails before rendering when reading `localStorage` throws.
- Fallback persistence can be in-memory for the current page lifecycle; durability across reload is not guaranteed when storage is blocked.
- After widget source changes, run `npm run sync-widget` so backend-served SDK matches the source bundle used by E2E.

- [ ] **Step 1: Write the failing test**

Add `widget/src/BasjooWidget.storage.test.tsx` or the nearest existing widget test file with assertions for:
- `window.localStorage.getItem` throwing does not throw during widget construction/init;
- widget creates its container/button when storage access is denied;
- visitor/session storage falls back to memory and returns values during the same page lifecycle.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd /Users/yi/Documents/Projects/basjoo/widget && npm run test -- --run BasjooWidget.storage
```

Expected: FAIL because direct `localStorage` access throws.

- [ ] **Step 3: Implement the minimal code**

Modify `widget/src/BasjooWidget.tsx`:
- introduce a small storage adapter with `getItem`, `setItem`, and `removeItem`;
- wrap all browser storage access in try/catch;
- fall back to an in-memory `Map<string, string>` when storage is unavailable;
- replace direct visitor id and session id `localStorage` usage with the adapter;
- keep existing key names unchanged for backward compatibility.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
cd /Users/yi/Documents/Projects/basjoo/widget && npm run test -- --run BasjooWidget.storage
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Keep the adapter local to the widget unless multiple widget modules need it, and avoid changing public widget initialization options.

- [ ] **Step 6: Run relevant broader verification**

```bash
cd /Users/yi/Documents/Projects/basjoo/widget && npm run build && npm run test
cd /Users/yi/Documents/Projects/basjoo && npm run sync-widget
cd /Users/yi/Documents/Projects/basjoo && HOST_ALLOWED_URL=http://allowed.local:8080 HOST_BLOCKED_URL=http://blocked.local:8081 API_BASE_URL=http://localhost:8000 npm run test:e2e:widget
```

Expected: PASS; `backend/static/sdk.js` reflects the rebuilt widget bundle.

- [ ] **Step 7: Commit**

```bash
git add widget/src/BasjooWidget.tsx widget/src/BasjooWidget.storage.test.tsx backend/static/sdk.js
git commit -m "fix: guard widget storage access"
```

---

### Task 5: Lock playground chat input selector and rebuild path

**Purpose:** Prevent stale or missing chat input selectors from breaking Playwright user-flow tests.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `frontend-nextjs/src/components/ChatPanel.tsx`
  - `frontend-nextjs/src/views/Playground.tsx`
- Reads:
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `frontend-nextjs/package.json`
  - `frontend-nextjs/src/views/AgentPanel.tsx`
- Must not edit:
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/fixtures/e2e-context.ts`
  - `widget/src/BasjooWidget.tsx`

**Files:**
- Modify: `frontend-nextjs/src/components/ChatPanel.tsx`
- Modify: `frontend-nextjs/src/views/Playground.tsx` only if the target branch has a view-owned input instead of `ChatPanel` ownership
- Create/Test: `frontend-nextjs/src/components/__tests__/ChatPanel.test.tsx`

**Context for implementer:**
- Current exploration says `ChatPanel.tsx` already has `data-testid="chat-message-input"`; verify in the target branch before editing.
- If the attribute is present, add only a regression test and focus on ensuring Docker/Next assets are rebuilt before E2E.
- Do not change user-visible chat input text, placeholder, or send behavior for this task.

- [ ] **Step 1: Write the failing test**

Create or update `frontend-nextjs/src/components/__tests__/ChatPanel.test.tsx` with assertions for:
- the rendered chat input has `data-testid="chat-message-input"`;
- the input remains a visible textbox for user typing;
- the test id exists on both desktop and mobile paths if `Playground.tsx` renders separate instances.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs && npm run test -- ChatPanel
```

Expected: FAIL if the target branch lacks the test id or lacks regression coverage.

- [ ] **Step 3: Implement the minimal code**

Modify `frontend-nextjs/src/components/ChatPanel.tsx`:
- add or preserve `data-testid="chat-message-input"` on the actual visible input or textarea used by users;
- ensure disabled/loading states do not remove the element from the DOM.

Modify `frontend-nextjs/src/views/Playground.tsx` only if it defines a separate input outside `ChatPanel` on the target branch:
- add the same test id to that visible input.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs && npm run test -- ChatPanel
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Keep selectors stable and avoid introducing conditional test ids based on viewport.

- [ ] **Step 6: Run relevant broader verification**

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs && npm run build && npm run typecheck && npm run test
cd /Users/yi/Documents/Projects/basjoo && docker compose --profile dev up -d --build frontend-dev
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts --grep "send message and receive streaming response|clear chat resets conversation"
```

Expected: PASS or fail for non-selector reasons already covered by Task 2 or Task 3.

- [ ] **Step 7: Commit**

```bash
git add frontend-nextjs/src/components/ChatPanel.tsx frontend-nextjs/src/views/Playground.tsx frontend-nextjs/src/components/__tests__/ChatPanel.test.tsx
git commit -m "test: lock playground chat input selector"
```

---

### Task 6: Full E2E verification and bug report update

**Purpose:** Prove all repaired behavior passes across smoke, widget, and prod-like E2E suites and record final bug status.

**Execution Metadata:**
- Dependencies: `Task 1`, `Task 2`, `Task 3`, `Task 4`, `Task 5`
- Parallelizable: `no`
- Batch: `3`
- Owns:
  - `E2E_BUG_REPORT.md`
  - `E2E_RAW_OUTPUT.txt`
- Reads:
  - `tests/e2e/playwright.config.ts`
  - `tests/e2e/specs/admin-auth.spec.ts`
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
  - `tests/e2e/specs/widget-cross-origin.spec.ts`
- Must not edit:
  - `backend/api/v1/endpoints.py`
  - `frontend-nextjs/src/components/ChatPanel.tsx`
  - `widget/src/BasjooWidget.tsx`

**Files:**
- Modify/Docs: `E2E_BUG_REPORT.md`
- Modify/Docs: `E2E_RAW_OUTPUT.txt`

**Context for implementer:**
- This task is verification and reporting; do not patch application code while running it.
- If a verification command fails, stop and assign the failure back to the owning task instead of editing files here.
- Redact API keys in logs before writing raw output.

- [ ] **Step 1: Write the failing test**

No new test file is required in this task. The failing baseline is the existing suite failures recorded in `E2E_BUG_REPORT.md` and `E2E_RAW_OUTPUT.txt`:
- BUG-001 chat input selector;
- BUG-002 login helper race;
- BUG-003 KB setup binding;
- BUG-004 chat response contract/retrieval;
- BUG-005 widget storage denial;
- BUG-006 KB upload route misuse.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd /Users/yi/Documents/Projects/basjoo && test -f E2E_BUG_REPORT.md && test -f E2E_RAW_OUTPUT.txt
```

Expected: PASS confirming baseline evidence exists; unresolved bug IDs in the report represent the RED baseline for this verification task.

- [ ] **Step 3: Implement the minimal code**

Update `E2E_BUG_REPORT.md` after verification:
- mark each bug as `Resolved` or `Still failing`;
- include the exact command output summary for each suite;
- include remaining failures with test names and owner task if any.

Update `E2E_RAW_OUTPUT.txt`:
- replace prior raw output with the redacted final command outputs;
- preserve suite names, command lines, counts, failed tests, skipped tests, and durations.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
cd /Users/yi/Documents/Projects/basjoo && npm run typecheck:e2e
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e
cd /Users/yi/Documents/Projects/basjoo && HOST_ALLOWED_URL=http://allowed.local:8080 HOST_BLOCKED_URL=http://blocked.local:8081 API_BASE_URL=http://localhost:8000 npm run test:e2e:widget
```

Expected: PASS for typecheck, smoke E2E, and widget E2E.

- [ ] **Step 5: Refactor while staying green**

Keep report language concise, preserve bug IDs, and remove duplicate raw sections that do not add diagnostic value.

- [ ] **Step 6: Run relevant broader verification**

```bash
cd /Users/yi/Documents/Projects/basjoo && docker compose --profile prod up -d --build backend-prod frontend-prod nginx
cd /Users/yi/Documents/Projects/basjoo && E2E_ENV=prod API_BASE_URL=http://localhost E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e:prod
```

Expected: PASS for prod-like E2E with no unresolved critical or high-severity regressions.

- [ ] **Step 7: Commit**

```bash
git add E2E_BUG_REPORT.md E2E_RAW_OUTPUT.txt
git commit -m "test: document resolved e2e bugs"
```
