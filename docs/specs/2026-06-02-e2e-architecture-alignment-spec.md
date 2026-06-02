# E2E Architecture Alignment Spec

**Status:** Draft
**Date:** 2026-06-02
**Owner:** Basjoo maintainers

## Summary

Bring the root-level Playwright E2E suite back into alignment with the current Basjoo architecture: multi-agent dashboard routes under `/agents/[agentId]/...`, self-KB/file-based knowledge management, and the current API surface. The change should remove stale QA/index endpoint assumptions from E2E tests, make navigation agent-aware, and clean up E2E TypeScript editor diagnostics without reintroducing deprecated product APIs.

## Problem

The current E2E smoke suite fails because it was written for an older architecture. Investigation with seven debugging subagents confirmed three root causes:

1. The tests and setup still reference removed QA endpoints: `POST /api/v1/qa:batch_import` and `GET /api/v1/qa:list`.
2. The tests navigate to deprecated root-level dashboard paths such as `/playground`, `/sessions`, and `/qa`, while real operational pages now live under `/agents/[agentId]/...`.
3. The root E2E TypeScript environment lacks Node.js type definitions, causing LSP diagnostics for `process` and `Buffer`.

Several initially reported failures are downstream symptoms of the route mismatch rather than independent UI bugs. For example, Playground chat input, temperature slider, and Sessions heading are present on the correct agent-scoped pages, but tests never reach those pages.

## Goals

- Update the E2E test contract to use current agent-scoped frontend routes.
- Replace stale QA/import/index assumptions with tests for the current knowledge management model.
- Ensure E2E setup exposes or resolves a valid agent ID for tests that need agent-scoped paths.
- Preserve meaningful coverage for authentication, playground chat, session takeover, URL safety, widget safety, and knowledge/source flows.
- Remove LSP/TypeScript noise in E2E files by making Node globals known to the editor/type system.
- Avoid reintroducing deprecated QA endpoints solely to satisfy old tests.

## Non-Goals

- Do not restore `qa:*` endpoints unless a separate product decision explicitly reintroduces curated Q&A as a first-class feature.
- Do not change production route behavior for `/playground`, `/sessions`, or `/qa` unless separately approved.
- Do not redesign the KB ingestion pipeline.
- Do not add broad new product functionality beyond E2E/test alignment.
- Do not weaken tests by deleting important coverage without replacing it with current-architecture coverage.

## Users / Actors

- **Maintainers / developers:** Need reliable local and CI E2E feedback.
- **Release reviewers:** Need confidence that smoke tests cover current critical flows.
- **Future agents / contributors:** Need clear test contracts that match the active architecture.
- **Admin users and widget visitors:** Indirectly benefit from regression coverage across admin and chat flows.

## Current State

### E2E test suite

Root Playwright config and specs live under `tests/e2e/`:

- `tests/e2e/playwright.config.ts`
- `tests/e2e/global.setup.ts`
- `tests/e2e/specs/admin-auth.spec.ts`
- `tests/e2e/specs/knowledge-indexing.spec.ts`
- `tests/e2e/specs/playground-streaming.spec.ts`
- `tests/e2e/specs/sessions-takeover.spec.ts`
- `tests/e2e/specs/recent-commits.spec.ts`
- `tests/e2e/specs/widget-cross-origin.spec.ts`

Observed smoke result before this spec:

- 16 tests total
- 8 passed
- 6 failed
- 2 skipped

### Confirmed stale QA assumptions

`knowledge-indexing.spec.ts` and `global.setup.ts` reference endpoints that no longer exist:

- `POST /api/v1/qa:batch_import`
- `GET /api/v1/qa:list`

Subagent investigation confirmed:

- No `qa:*` route is registered in `backend/api/v1/endpoints.py`.
- No QA API methods exist in `frontend-nextjs/src/services/api.ts`.
- `frontend-nextjs/app/(dashboard)/qa/page.tsx` redirects to `/files`.
- Git history indicates QA endpoints were removed during the R2R migration and not restored after self-KB migration.

### Current frontend route architecture

Root operational routes are redirect stubs:

| Root path | Current behavior |
|---|---|
| `/playground` | Redirects to `/` |
| `/sessions` | Redirects to `/` |
| `/qa` | Redirects to `/files` |
| `/knowledge` | Redirects to `/` |
| `/urls` | Redirects to `/` |
| `/users` | Redirects to `/` |

Real operational pages are agent-scoped:

| Current page | Path |
|---|---|
| Agent dashboard | `/agents/[agentId]/dashboard` |
| Playground | `/agents/[agentId]/playground` |
| Sessions | `/agents/[agentId]/sessions` |
| Files / knowledge upload | `/agents/[agentId]/files` |
| URLs | `/agents/[agentId]/urls` |
| Agent settings | `/agents/[agentId]/settings/agent` |

### Current API / KB model

The current backend exposes agent, chat, URL, file, sessions, and self-KB document APIs. Relevant current endpoints include:

- `GET /api/v1/agent:default`
- `GET /api/v1/agent`
- `PUT /api/v1/agent?agent_id=...`
- `POST /api/v1/chat`
- `POST /api/v1/chat/stream`
- `GET /api/v1/chat/messages`
- `GET /api/v1/admin/sessions`
- `POST /api/v1/admin/sessions/{id}/takeover`
- `POST /api/v1/admin/sessions/send`
- `GET /api/v1/urls:list`
- `POST /api/v1/urls:create`
- `GET /api/v1/files:list`
- `POST /api/v1/files:upload`
- `GET /api/v1/sources:summary`
- Tenant-scoped KB document endpoints in `backend/api/v1/kb_document_endpoints.py`

Legacy `qa:*`, `index:rebuild`, and `index:status` assumptions should be treated as obsolete unless verified against current code.

### TypeScript diagnostics

The root package currently only declares `@playwright/test` as a dev dependency. There is no root `tsconfig.json`, no `tests/e2e/tsconfig.json`, and no root `@types/node`. LSP reports missing `process` and `Buffer`, but Playwright runtime still executes because it uses its own compilation pipeline.

## Proposed Design

### Design principle

E2E tests should verify current external behavior, not preserve historical implementation details. The suite should model how an admin actually reaches agent-scoped pages and how current KB/source APIs work.

### Approach

Adopt a compatibility-forward test contract:

1. Use API setup to authenticate and resolve a valid default agent ID.
2. Store that agent context in a reusable E2E fixture or shared setup artifact.
3. Navigate UI tests to current agent-scoped paths.
4. Rewrite knowledge/indexing coverage around current file/source/KB behavior rather than removed QA endpoints.
5. Keep root-level redirect behavior explicitly tested only if it is a supported compatibility behavior.
6. Add E2E TypeScript configuration for Node globals.

### Alternatives considered

#### Alternative A: Restore old `qa:*` endpoints

This would make stale tests pass with minimal test changes, but it would reintroduce an API surface that the current product no longer uses. It risks creating misleading product behavior and additional maintenance burden.

**Decision:** Not recommended.

#### Alternative B: Make root routes redirect to the default agent page

For example, `/playground` could resolve the default agent and redirect to `/agents/{id}/playground`. This may improve bookmark compatibility, but it changes runtime app behavior and requires product/UX approval.

**Decision:** Out of scope for this E2E alignment spec. Tests should target current canonical paths.

#### Alternative C: Update tests to current canonical paths and APIs

This aligns the suite with existing architecture without adding compatibility code or deprecated APIs.

**Decision:** Recommended.

## Behavior / User Experience

### E2E setup behavior

- Global setup MUST ensure an admin account exists and can authenticate.
- Global setup or fixtures MUST resolve a usable default agent ID through the current API.
- Tests that need an agent context MUST use that resolved agent ID.
- Setup SHOULD avoid mutating persistent state in ways that conflict with existing local/prod-like volumes.
- Setup SHOULD tolerate an already-configured admin, but it MUST not silently proceed with credentials that cannot log in.

### Navigation behavior under test

- Tests for Playground MUST navigate to `/agents/{agentId}/playground`.
- Tests for Sessions MUST navigate to `/agents/{agentId}/sessions`.
- Tests for Files/knowledge management MUST navigate to `/agents/{agentId}/files` or another current canonical knowledge page.
- Tests MUST NOT expect `/playground`, `/sessions`, or `/qa` root paths to render operational pages.
- If root redirects remain important, they SHOULD be covered by explicit redirect tests that assert the current supported redirect target.

### Knowledge/source behavior under test

The knowledge E2E spec SHOULD verify current behavior such as:

- File/source management page renders for the selected agent.
- Current source summary/list APIs respond with the expected shape.
- Upload or source creation flows use current endpoints and produce visible status changes.
- URL safety and SSRF rejection remain covered.

The knowledge E2E spec MUST NOT call removed QA endpoints:

- `POST /api/v1/qa:batch_import`
- `GET /api/v1/qa:list`

The spec SHOULD also avoid unverified legacy index endpoints unless the current backend explicitly supports them.

### Playground behavior under test

- Chat input SHOULD be located through accessible role/name or stable test ID on the correct agent-scoped page.
- The current chat input accessible label is expected to match `playground.inputPlaceholder` translations.
- Temperature settings SHOULD be tested on the current UI where the native range input is rendered.
- Auto-save assertions SHOULD match actual visible UI text and current `PUT /api/v1/agent?agent_id=...` behavior.
- If text is split across sibling elements, tests SHOULD avoid brittle regex assumptions requiring a single text node with parentheses.

### Sessions behavior under test

- API-created visitor sessions SHOULD appear on the selected agent's sessions page when that page is opened through `/agents/{agentId}/sessions`.
- The expected heading SHOULD match the current `settings.chatCenter` translations or a stable semantic/test selector.
- Human takeover API coverage SHOULD remain, as it currently passes and covers an important critical path.

### TypeScript/LSP behavior

- E2E files SHOULD have Node.js globals available to TypeScript tooling.
- Fixing LSP diagnostics MUST NOT change Playwright runtime semantics.

## Architecture and Components

### `tests/e2e/global.setup.ts`

Responsible for global authentication/setup and resolving shared context needed by tests. It should stop referencing removed QA endpoints. It may persist resolved test context, such as default agent ID, in a Playwright-friendly artifact or fixture mechanism.

### `tests/e2e/fixtures/`

Should provide reusable helpers for:

- Admin login
- Authenticated API requests
- Resolving default agent ID
- Building agent-scoped route paths
- Creating isolated visitor sessions or source fixtures where needed

### E2E spec files

- `admin-auth.spec.ts`: Continue covering login, invalid credentials, refresh persistence, and expired token behavior.
- `playground-streaming.spec.ts`: Use agent-scoped route and current selectors/API expectations.
- `sessions-takeover.spec.ts`: Keep API takeover chain; update UI route to agent-scoped path.
- `knowledge-indexing.spec.ts`: Replace QA/import/index assertions with current file/source/KB behavior.
- `recent-commits.spec.ts`: Review skipped tests and obsolete indexing assumptions before re-enabling.
- `widget-cross-origin.spec.ts`: Keep focused on widget embed/cross-origin behavior.

### Frontend routes

Current redirect stubs are part of the observed architecture. This spec does not require changing them.

Relevant files:

- `frontend-nextjs/app/(dashboard)/playground/page.tsx`
- `frontend-nextjs/app/(dashboard)/sessions/page.tsx`
- `frontend-nextjs/app/(dashboard)/qa/page.tsx`
- `frontend-nextjs/app/(dashboard)/agents/[agentId]/playground/page.tsx`
- `frontend-nextjs/app/(dashboard)/agents/[agentId]/sessions/page.tsx`
- `frontend-nextjs/app/(dashboard)/agents/[agentId]/files/page.tsx`

### Backend APIs

The E2E suite should use current backend contracts rather than deleted QA contracts.

Relevant files:

- `backend/api/v1/endpoints.py`
- `backend/api/v1/kb_document_endpoints.py`
- `backend/services/kb_service.py`
- `backend/services/kb_document_processor.py`
- `backend/services/qdrant_service.py`

### TypeScript config / dependencies

Root E2E tooling should make Node types available without interfering with `frontend-nextjs/` or `widget/` TypeScript configurations.

## Data Model / Contracts

### E2E shared agent context

Tests that need agent-scoped routes require this logical context:

```ts
interface E2EAgentContext {
  agentId: string;
  adminEmail: string;
  apiBaseUrl: string;
  baseUrl: string;
}
```

The exact storage mechanism is an implementation detail, but the contract is:

- `agentId` MUST refer to an existing agent accessible to the authenticated admin.
- `apiBaseUrl` MUST point to the backend under test.
- `baseUrl` MUST point to the frontend under test.

### Route builder contract

Agent-scoped tests should construct routes from the resolved `agentId`:

```text
/agents/{agentId}/dashboard
/agents/{agentId}/playground
/agents/{agentId}/sessions
/agents/{agentId}/files
/agents/{agentId}/urls
/agents/{agentId}/settings/agent
```

### Removed API contract

These endpoints are explicitly not part of the current E2E contract:

```text
POST /api/v1/qa:batch_import
GET /api/v1/qa:list
```

Any test calling them should be considered stale unless a separate approved spec reintroduces QA APIs.

### Node type contract

E2E TypeScript files may use Node globals such as:

- `process`
- `Buffer`

Tooling should recognize these symbols.

## Error Handling and Edge Cases

### Existing admin already configured

If `/api/admin/register` returns an "admin already configured" response, setup should proceed only if login with configured E2E credentials succeeds. If login fails, setup should fail with a clear message explaining that the persistent database contains a different admin account.

### Missing default agent

If `GET /api/v1/agent:default` fails or returns no usable agent ID, E2E setup should fail before UI tests run. Tests should not fall back to root routes.

### Deleted or inaccessible agent

If an agent-scoped page returns an error because the agent is deleted or inaccessible, the test should surface that as setup/context failure rather than timing out on missing UI elements.

### Route redirects

If tests intentionally visit deprecated root paths, they should assert redirect behavior. They should not expect operational UI on those paths.

### Slow async source processing

Knowledge/source tests should avoid fixed sleeps where possible. They should poll current status endpoints or assert immediate externally visible behavior, depending on what the current API guarantees.

### External provider variability

Tests using real DeepSeek/Jina/SiliconFlow provider keys should be opt-in or clearly marked, because network/provider failures can make E2E flaky. Smoke tests should prefer behavior that can run deterministically against the local stack unless a real-provider test is explicitly requested.

### Persistent Docker volumes

Local Docker volumes may contain prior admin, agent, source, or session data. E2E setup should isolate data where practical and avoid assuming a blank database.

## Testing Strategy

### Smoke E2E expectations

The smoke suite should pass against:

```bash
npm run test:e2e
```

when the dev Docker stack is healthy and required environment variables are configured.

### Targeted coverage

The updated suite should verify:

- Admin login succeeds and redirects away from `/login`.
- Invalid credentials show a user-visible error.
- Refresh preserves auth state.
- Expired token triggers logout.
- Agent-scoped Playground page renders expected controls.
- Playground chat can send a message and observe a response or controlled error state.
- Agent update auto-save triggers the current update endpoint and shows current saved state.
- Session takeover via API works.
- Agent-scoped Sessions page shows created visitor sessions.
- URL safety rejects SSRF-like URLs without server errors.
- Knowledge/source management tests use current endpoints and pages.
- Widget renderer does not execute malicious markdown-like content.

### Type/tooling checks

The repository should support LSP diagnostics for E2E files without Node-global errors. If a TypeScript check command is added for root E2E files, it should pass under the same Node type assumptions.

### Regression expectations

The following failures should no longer occur after implementing this spec:

- 404 from `qa:batch_import` during E2E setup.
- 404 from `qa:list` in knowledge tests.
- Playground tests landing on `AgentPanel` instead of Playground.
- Sessions UI tests landing on `AgentPanel` instead of Sessions.
- LSP reports for missing `process` / `Buffer` in E2E files.

## Migration / Rollout

This is a test-suite alignment change and should be rolled out without production feature flags.

Recommended rollout characteristics:

- Keep old E2E report as historical evidence but avoid storing secrets in reports.
- Update tests in a way that works with non-empty Docker volumes.
- Run the dev stack before verification:
  ```bash
  docker compose --profile dev up -d --build
  ```
- Verify with:
  ```bash
  npm run test:e2e
  ```
- For frontend/test dependency changes, ensure root install remains lightweight and does not conflict with `frontend-nextjs/` or `widget/` package boundaries.
- If knowledge tests are rewritten to use file upload or KB document endpoints, document any required fixture files under `tests/e2e/fixtures/`.

## Open Questions

- Should deprecated root routes remain redirect stubs, or should they redirect to the default agent's scoped page?  
  **Recommended default:** Keep current runtime behavior and update E2E tests to canonical agent-scoped paths.

- Should curated QA pairs return as a product feature, or is file/self-KB knowledge the only supported path going forward?  
  **Recommended default:** Do not restore QA APIs for this E2E fix; treat QA references as stale tests.

- Should real external provider tests be part of smoke E2E or a separate opt-in project?  
  **Recommended default:** Keep smoke deterministic where possible; put real-provider tests in an explicitly skipped/opt-in project.

- Which current knowledge path should replace the old QA indexing test: file upload, URL source creation, tenant-scoped KB document upload, or source summary only?  
  **Recommended default:** Use the highest-level user-facing flow that is currently supported by the admin UI, likely agent-scoped file/source management plus `sources:summary` verification.
