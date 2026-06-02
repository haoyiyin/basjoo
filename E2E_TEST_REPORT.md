# E2E Test Report - Branch: refactor/kb-architecture
## Date: 2026-06-02

## Deployment Setup
- **Branch**: `refactor/kb-architecture` (latest commit: `e7998a0`)
- **Deployment**: `docker compose --profile dev up --build -d`
- **API Keys Used**:
  - DeepSeek: `sk-***REDACTED***` (provided for testing)
  - Jina: `jina_***REDACTED***` (provided for testing)
- **Services Status**: All healthy (backend, frontend, redis, postgres, qdrant, scrapling)

## Test Results Summary
```
16 tests total
  8 passed ✓
  6 failed ✗
  2 skipped -
```

### Passing Tests (8)
1. ✅ URL safety rejects SSRF-like URLs without server errors
2. ✅ Full takeover chain via API
3. ✅ Auth language switcher works before login
4. ✅ Login with valid credentials redirects to dashboard
5. ✅ Widget renderer does not execute malicious markdown-like content in welcome message
6. ✅ Refresh page preserves login state
7. ✅ Invalid credentials show error
8. ✅ Expired token triggers auto-logout

### Failing Tests (6)
1.  QA import and index rebuild
2. ❌ QA management UI shows imported items
3. ❌ Playground auto-save shows saving/saved state
4. ❌ Playground send message and receive streaming response
5. ❌ Playground clear chat resets conversation
6. ❌ Sessions page shows visitor sessions after login

### Skipped Tests (2)
1. ️ Provider keys are saved, masked, switchable, and usable for embedding API tests
2. ⏭️ SiliconFlow embedding can rebuild QA index and retrieve context

---

## Bug Documentation

### BUG-001: Missing QA Batch Import API Endpoint
**Severity**: High
**Location**: `backend/api/v1/`
**Description**: The E2E test setup (`tests/e2e/global.setup.ts`) and knowledge-indexing tests reference `POST /api/v1/qa:batch_import` endpoint, but this endpoint does not exist in the backend codebase. The global setup fails with 404, and tests that depend on QA seeding cannot run properly.

**Evidence**:
```
POST /api/v1/qa%3Abatch_import?agent_id=agt_580d59a26002 HTTP/1.1" 404 Not Found
```

**grep search confirms**: No `batch_import` or `qa:batch` route exists in any backend Python file.

**Fix Required**: Either implement the `qa:batch_import` endpoint or remove/skip the QA seeding step in E2E setup.

---

### BUG-002: Missing QA List API Endpoint
**Severity**: High
**Location**: `backend/api/v1/`
**Description**: The knowledge-indexing test (`knowledge-indexing.spec.ts:92`) calls `GET /api/v1/qa:list` endpoint which returns 404. The test then tries to access `qaList.total` which is undefined, causing a matcher error.

**Fix Required**: Implement the `qa:list` endpoint or fix the test to use the correct endpoint.

---

### BUG-003: Root-level Routes Redirect to Dashboard (Breaking E2E Navigation)
**Severity**: Critical
**Location**: `frontend-nextjs/app/(dashboard)/`
**Description**: The E2E tests navigate to root-level routes (`/playground`, `/sessions`) which immediately redirect to `/` (agent selector) or `/files`. The actual pages require an agent context and live at `/agents/[agentId]/playground`, `/agents/[agentId]/sessions`.

**Affected files**:
- `app/(dashboard)/playground/page.tsx` → redirects to `/`
- `app/(dashboard)/sessions/page.tsx` → redirects to `/`
- `app/(dashboard)/qa/page.tsx` → redirects to `/files`

**Impact**: All E2E tests that navigate to these root routes fail because the page content never loads - the user is redirected back to the agent selector dashboard.

**Evidence**: All failure screenshots show the "智能体面板" (Agent Dashboard) page instead of the expected playground or sessions pages.

**Fix Options**:
1. Update E2E tests to navigate to agent-specific routes (requires selecting an agent first)
2. Implement root-level pages that work without agent context
3. Add automatic agent selection/redirect in the root-level routes

---

### BUG-004: Playground Chat Input Accessibility Label Mismatch
**Severity**: Medium
**Location**: `frontend-nextjs/app/(dashboard)/agents/[agentId]/playground/`
**Description**: The E2E test looks for a textbox with role name matching `/输入您的问题|your question/i` but the actual playground page may use different placeholder text or the input may not have the proper aria-label attribute.

**Fix Required**: Add proper `aria-label` to the chat input in the playground component, or update the test selector to match the actual implementation.

---

### BUG-005: Playground Temperature Input Selector Issue
**Severity**: Medium
**Location**: `frontend-nextjs/app/(dashboard)/agents/[agentId]/playground/`
**Description**: The test looks for `input[type="range"], input[type="number"]` but the playground settings may not have these elements visible, or they may be implemented differently (e.g., as custom slider components).

**Fix Required**: Verify the playground settings UI has the expected input elements with proper attributes, or update the test selector.

---

### BUG-006: Sessions Page Heading Not Found
**Severity**: Medium
**Location**: `frontend-nextjs/app/(dashboard)/agents/[agentId]/sessions/`
**Description**: The test looks for a heading with name matching `/会话中心|sessions/i` but the actual sessions page may use different heading text.

**Fix Required**: Ensure the sessions page has a proper heading element with accessible name matching the test expectation, or update the test selector.

---

### BUG-007: Pre-existing - Missing @types/node in E2E Test Environment
**Severity**: Low
**Location**: `tests/e2e/`
**Description**: TypeScript reports "Cannot find name 'process'" in `global.setup.ts` and test files because `@types/node` is not installed in the E2E test dependencies.

**Fix**: Add `@types/node` to devDependencies or configure TypeScript to include node types.

---

## Root Cause Analysis

The primary issue is that the E2E tests were written for a previous architecture where:
1. Root-level routes (`/playground`, `/sessions`, `/qa`) had actual page content
2. QA API endpoints (`batch_import`, `list`) existed

The current architecture has:
1. Root-level routes that redirect to agent selector or files page
2. No QA batch import or list endpoints implemented

This suggests the E2E tests need to be updated to match the current architecture, specifically:
- Navigate to agent-specific routes after selecting an agent
- Remove or implement the missing QA API endpoints
- Update selectors to match the current UI implementation

---

## Recommendations

1. **Fix E2E Test Navigation**: Update tests to select an agent first, then navigate to agent-specific routes
2. **Implement Missing QA Endpoints**: Create `/api/v1/qa:batch_import` and `/api/v1/qa:list` endpoints
3. **Add Accessibility Attributes**: Ensure all interactive elements have proper aria-labels for E2E testing
4. **Fix TypeScript Types**: Add `@types/node` to resolve `process.env` type errors
5. **Consider Test Isolation**: Each test should set up its own agent context rather than relying on global setup

---

## Environment Notes

- Qdrant service showed as "unhealthy" in docker status but health check endpoint responded correctly
- Both prod and dev services were running simultaneously (no port conflicts due to different port mappings)
- Admin user had to be reset in database because prod deployment had pre-configured admin credentials
