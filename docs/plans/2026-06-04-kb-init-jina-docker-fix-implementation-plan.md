# Jina KB Initialization Docker Bug Fix Implementation Plan

**Status:** Draft
**Date:** 2026-06-04
**Source:** User report: local Docker deployment accepts a valid Jina API key, but clicking “初始化知识库” appears to do nothing.
**Goal:** Make Jina knowledge-base initialization reliable, state-consistent, and visibly diagnosable in local Docker and normal admin UI flows.
**Architecture:** The fix should restore backend source-of-truth consistency first: a successful setup response must mean the agent has a bound KB, `kb_setup_completed=true`, and the Qdrant collection is available or an actionable error was returned. The frontend should then present setup as an explicit, observable operation, preventing the Jina key blur-test from confusing the setup click and surfacing incomplete backend state as an error. Docker verification should prove the UI click maps to the setup API and that Qdrant-related failures are visible instead of looking inert.
**Tech Stack:** FastAPI, SQLAlchemy, Qdrant client, pytest; Next.js 14 App Router, React, TypeScript, Vitest/Testing Library, Playwright, Docker Compose.

## Planning Notes

- Exploration model: `kimi2.5`, provided by the user.
- Exploration was performed by four read-only subagents: frontend flow, backend flow, Docker/tests, and targeted root-cause verification.
- Main agent did not directly inspect repository files for exploration.
- The user-provided Jina key is treated as a test key and must not be committed to tests, plans, logs, or fixtures.
- Repair priority:
  1. Backend state consistency and regression tests.
  2. Frontend user-visible diagnostics and race prevention.
  3. Docker/manual verification for proxy and Qdrant dependency behavior.

## Exploration Summary

- Frontend initialization UI is in `frontend-nextjs/src/components/KBSetupWizard.tsx`.
  - “初始化知识库” button calls `handleSetup`.
  - The button is disabled only by `settingUp || !apiKey.trim()`.
  - The API key input auto-runs `handleTest()` on blur.
  - Clicking the setup button after typing can trigger blur-test and setup concurrently.
  - Errors are displayed inline; no success toast or explicit “backend still incomplete” diagnostic was found.
- Frontend API calls are centralized in `frontend-nextjs/src/services/api.ts`.
  - `kbSetup()` posts to `/api/v1/agent:kb-setup?agent_id=...`.
  - `testJinaApi()` posts to `/api/v1/agent:test-jina-api?agent_id=...`.
  - Docker frontend routing uses relative `/api/...` through Next rewrites in dev or nginx in prod.
- Backend setup endpoint is in `backend/api/v1/endpoints.py`.
  - `POST /api/v1/agent:kb-setup?agent_id=...` stores provider config and calls `KbService.get_or_create_agent_kb()`.
  - Jina key validation is separate from setup; `kb-setup` does not call Jina.
  - Setup depends on Qdrant collection creation, so a valid Jina key can still be followed by setup failure if Qdrant is unavailable.
- Backend KB binding logic is in `backend/services/kb_service.py`.
  - `KbService._get_or_create_agent_kb_with_session()` has an existing-KB path that returns without setting `agent.kb_setup_completed=True`.
  - `kb_reset` can create the broken state by setting `kb_setup_completed=False` while leaving `kb_id` populated.
- Docker deployment sets `QDRANT_URL=http://qdrant:6333`, but backend services do not declare Qdrant as a health-gated dependency. Backend `/health` does not verify Qdrant.

## Debugging Findings

- **Primary root cause, high confidence:** If an agent has `kb_id` set and `kb_setup_completed=false`, `KbService._get_or_create_agent_kb_with_session()` returns the existing KB without setting `kb_setup_completed=True`, without committing, and without re-ensuring the Qdrant collection. The setup endpoint can therefore return HTTP 200 with a success message while status remains incomplete. The frontend rechecks status and leaves the wizard visible, which appears to the user as “nothing happened.”
- **State source, high confidence:** `kb_reset` sets `agent.kb_setup_completed=False` and does not clear `agent.kb_id`, creating exactly the state that makes re-initialization appear inert.
- **Frontend UX/race contributor, medium confidence:** The API key field’s blur handler can start a Jina test request at the same time as the setup click. This overlap is not proven to cancel setup, but it can produce confusing state and should be coordinated.
- **Docker contributor, medium confidence:** Setup requires Qdrant. If Qdrant is unhealthy or slow, the UI may only show a generic inline failure after timeout. This does not explain the confirmed state-consistency bug, but it should be made diagnosable.

## File Map

- `backend/services/kb_service.py`
  - Modify `KbService._get_or_create_agent_kb_with_session()` existing-`agent.kb_id` branch.
- `backend/api/v1/endpoints.py`
  - Review `kb_setup()` success criteria and `kb_reset` behavior.
  - Ensure setup does not report success unless the completed flag and KB binding are consistent.
- `backend/tests/test_kb_agent_binding.py`
  - Add regressions for `kb_id` present with `kb_setup_completed=false` and for reset-then-reinitialize.
- `frontend-nextjs/src/components/KBSetupWizard.tsx`
  - Coordinate blur-test with setup click.
  - Surface backend incomplete state as a visible error.
  - Improve loading/disabled state so setup is visibly in progress.
- `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`
  - Extend or add component-level coverage for setup success, incomplete backend response, and blur/click coordination.
- `frontend-nextjs/tests/unit/api.kbStatus.test.ts`
  - Extend only if request-shape or response-contract assertions need coverage.
- `tests/e2e/specs/knowledge-indexing.spec.ts`
  - Add or tighten a UI path that clicks the wizard button and verifies visible completion or a visible actionable error.
- `docker-compose.yml`
  - Consider adding health-gated Qdrant dependency for backend services if implementation confirms startup ordering contributes to local Docker failures.

## Parallelization Strategy

Execution model: **ordered with limited fan-out after backend contract is defined**.

- Batch 1, backend-only: add backend regression tests and fix state consistency. This batch owns backend service and endpoint files.
- Batch 2, frontend-only: after backend response semantics are clear, add UI tests and fix wizard diagnostics/race behavior. This batch owns frontend component and frontend tests.
- Batch 3, integration verification: after Batch 1 and Batch 2 are green, run Docker and E2E verification. This batch owns no production code unless Docker health-gating is proven necessary.

Do not edit backend and frontend test fixtures in parallel if they share seeded agent setup assumptions.

## Verification Commands

Backend targeted:

```bash
cd backend && pytest tests/test_kb_agent_binding.py -q
```

Backend broader:

```bash
cd backend && pytest tests/test_kb_agent_binding.py tests/test_api.py -q
```

Frontend targeted:

```bash
cd frontend-nextjs && npm run test -- tests/unit/Agents.kbOnboarding.test.tsx
```

Frontend required verification:

```bash
cd frontend-nextjs && npm run build && npm run typecheck && npm run test
```

E2E typecheck:

```bash
npm run typecheck:e2e
```

Docker smoke diagnostics:

```bash
docker compose --profile prod up -d --build
docker compose --profile prod ps
docker compose --profile prod logs --tail=200 backend-prod frontend-prod nginx qdrant
curl -i http://localhost/health
curl -i http://localhost:6333/health
```

Production-like E2E:

```bash
npm run test:e2e:prod
```

Manual browser verification:

1. Open the local Docker admin UI.
2. Create or select an agent whose KB setup wizard is visible.
3. Enter a Jina test key in the wizard.
4. Click “初始化知识库”.
5. Confirm the browser Network panel shows `POST /api/v1/agent:kb-setup?agent_id=...`.
6. Confirm the UI either navigates to the agent dashboard after completed status or shows an actionable error message naming the failed dependency or inconsistent state.

### Task 1: Add backend regression coverage for existing KB re-initialization

**Purpose:** Prove the confirmed backend bug before changing service logic.
**Execution Metadata:** dependencies: none; parallelizable: no; batch: backend-contract; owns: `backend/tests/test_kb_agent_binding.py`; reads: `backend/services/kb_service.py`, `backend/api/v1/endpoints.py`, `backend/models.py`; must-not-edit: frontend files, Docker files.
**Files:** modify/test `backend/tests/test_kb_agent_binding.py`.
**Context for implementer:** Create a test state where an agent has a valid `kb_id` but `kb_setup_completed=False`. This can be created directly in the test DB or through the reset endpoint if current fixtures make that reliable. The regression must fail against current code by showing setup returns success while status remains incomplete, or by asserting the expected completed status after setup.

- [ ] Step 1: Write a failing pytest for `agent.kb_id != None` and `agent.kb_setup_completed is False`, then call `POST /api/v1/agent:kb-setup?agent_id=...` with Jina config.
- [ ] Step 2: Run `cd backend && pytest tests/test_kb_agent_binding.py -q` and verify RED for the new assertion.
- [ ] Step 3: Add a second failing pytest for reset-then-reinitialize if existing fixtures can exercise `kb_reset` without brittle setup.
- [ ] Step 4: Run the focused backend test command again and keep the failure output for implementation context.
- [ ] Step 5: Commit only the failing backend tests if the team uses strict TDD commits; otherwise keep them staged for the implementation task.

### Task 2: Fix backend KB setup state consistency

**Purpose:** Ensure successful setup always leaves the agent in a completed, queryable, and committed KB state.
**Execution Metadata:** dependencies: Task 1; parallelizable: no; batch: backend-contract; owns: `backend/services/kb_service.py`, `backend/api/v1/endpoints.py`; reads: `backend/tests/test_kb_agent_binding.py`, `backend/services/qdrant_service.py`; must-not-edit: frontend files.
**Files:** modify `backend/services/kb_service.py`; modify `backend/api/v1/endpoints.py` only if endpoint success criteria or reset semantics need tightening; test `backend/tests/test_kb_agent_binding.py`.
**Context for implementer:** In the existing-`agent.kb_id` path, do not return before reconciling state. Re-ensure the Qdrant collection for the existing KB using the current embedding model, set `agent.kb_setup_completed=True`, commit, refresh, and return the reconciled objects. If the existing KB record cannot be found, fall through to create a new KB or clear the stale binding in a controlled way with a test proving the behavior.

- [ ] Step 1: Use the RED tests from Task 1 as the failing specification.
- [ ] Step 2: Update `KbService._get_or_create_agent_kb_with_session()` so an existing KB branch reconciles `kb_setup_completed`, ensures the collection, commits, and refreshes.
- [ ] Step 3: Review `kb_setup()` in `backend/api/v1/endpoints.py` so it returns success only after `kb_id` and `kb_setup_completed` are consistent in the returned agent config.
- [ ] Step 4: Keep `kb_reset` behavior compatible with preserved KB bindings, or clear stale bindings only with explicit regression coverage.
- [ ] Step 5: Run `cd backend && pytest tests/test_kb_agent_binding.py -q` and verify GREEN.
- [ ] Step 6: Run `cd backend && pytest tests/test_kb_agent_binding.py tests/test_api.py -q`.
- [ ] Step 7: Commit backend tests and implementation.

### Task 3: Add frontend coverage for setup diagnostics and click coordination

**Purpose:** Prove the UI no longer appears inert when backend setup succeeds incompletely, fails, or overlaps with key testing.
**Execution Metadata:** dependencies: Task 2 response semantics; parallelizable: yes after Task 2; batch: frontend-ui; owns: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`; reads: `frontend-nextjs/src/components/KBSetupWizard.tsx`, `frontend-nextjs/src/services/api.ts`; must-not-edit: backend files.
**Files:** modify/test `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`; modify `frontend-nextjs/tests/unit/api.kbStatus.test.ts` only if contract assertions are needed.
**Context for implementer:** Existing onboarding tests mock `api.kbSetup`, so add tests that assert component behavior around mocked setup outcomes. Cover a successful completed setup, a setup response or recheck that still reports incomplete, and the action of clicking setup immediately after leaving the API key field.

- [ ] Step 1: Write a failing test where `api.kbSetup` resolves but the completion path reports `kb_setup_completed=false`; expect a visible error instead of silent wizard persistence.
- [ ] Step 2: Write a failing test where the API key input blur would trigger `handleTest()` and the setup click still performs one reliable setup operation with deterministic button/loading state.
- [ ] Step 3: Run `cd frontend-nextjs && npm run test -- tests/unit/Agents.kbOnboarding.test.tsx` and verify RED.
- [ ] Step 4: Keep assertions focused on user-visible text, button state, and API-call counts.
- [ ] Step 5: Commit only the failing frontend tests if the team uses strict TDD commits; otherwise keep them staged for the frontend implementation task.

### Task 4: Fix KB setup wizard observability and race behavior

**Purpose:** Make the initialization click visibly reliable from the user’s perspective.
**Execution Metadata:** dependencies: Task 3; parallelizable: no; batch: frontend-ui; owns: `frontend-nextjs/src/components/KBSetupWizard.tsx`; reads: `frontend-nextjs/src/services/api.ts`, `frontend-nextjs/src/locales/`; must-not-edit: backend files.
**Files:** modify `frontend-nextjs/src/components/KBSetupWizard.tsx`; modify locale files only if new user-facing strings are introduced; test `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`.
**Context for implementer:** Do not rely on silent navigation as the only success signal. During setup, make the button state obvious. Prevent the blur-triggered test from overlapping the setup click by skipping blur-test when focus moves to the setup button, by disabling setup while `testing`, or by making testing explicit and non-blocking with a request token. After setup, if returned config or status recheck is not completed, show a clear inline error such as “知识库初始化未完成，请重试或查看服务日志。” Use the project’s existing i18n pattern for strings.

- [ ] Step 1: Use the RED tests from Task 3 as the failing specification.
- [ ] Step 2: Coordinate `handleTest()` and `handleSetup()` so clicking “初始化知识库” produces one deterministic setup flow.
- [ ] Step 3: Add explicit incomplete-state handling after `api.kbSetup()` and `onSetupComplete()`.
- [ ] Step 4: Add or update localized strings for setup-in-progress and incomplete setup errors if the component cannot reuse existing strings.
- [ ] Step 5: Run `cd frontend-nextjs && npm run test -- tests/unit/Agents.kbOnboarding.test.tsx` and verify GREEN.
- [ ] Step 6: Run `cd frontend-nextjs && npm run build && npm run typecheck && npm run test`.
- [ ] Step 7: Commit frontend tests and implementation.

### Task 5: Verify Docker behavior and decide on Qdrant health-gating

**Purpose:** Prove the local Docker deployment no longer looks inert and make Qdrant startup failures actionable.
**Execution Metadata:** dependencies: Tasks 2 and 4; parallelizable: no; batch: integration; owns: Docker files only if health-gating is proven necessary; reads: `docker-compose.yml`, `backend/main.py`, `nginx/conf.d/locations.conf`, `tests/e2e/specs/knowledge-indexing.spec.ts`; must-not-edit: backend/frontend behavior already covered by prior tasks unless verification exposes a regression.
**Files:** modify `docker-compose.yml` only if local Docker reproduction proves backend can accept setup traffic before Qdrant is reachable; modify `tests/e2e/specs/knowledge-indexing.spec.ts` if adding UI-path coverage.
**Context for implementer:** The fix should not require a real committed Jina key. Use environment variables or test doubles for automated tests. For manual verification, enter a disposable Jina key through the UI and inspect the Network panel and backend logs.

- [ ] Step 1: Run `docker compose --profile prod up -d --build`.
- [ ] Step 2: Run the Docker smoke diagnostics listed in Verification Commands and confirm backend, frontend/nginx, and Qdrant are reachable.
- [ ] Step 3: Manually click “初始化知识库” in the Docker UI and confirm the setup request has a visible completed or actionable-error outcome.
- [ ] Step 4: If backend starts before Qdrant readiness and this is reproducible, add Qdrant health-gated dependency for backend services in `docker-compose.yml` and rerun the Docker smoke diagnostics.
- [ ] Step 5: Add or tighten Playwright coverage for the wizard click path if existing E2E does not exercise the visible UI action.
- [ ] Step 6: Run `npm run typecheck:e2e`.
- [ ] Step 7: Run `npm run test:e2e:prod` after the production-like stack is up.
- [ ] Step 8: Commit integration test or Docker changes if any were required.
