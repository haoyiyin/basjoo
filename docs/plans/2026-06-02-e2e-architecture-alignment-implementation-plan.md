# E2E Architecture Alignment Implementation Plan

**Status:** Draft
**Date:** 2026-06-02
**Source Spec:** `docs/specs/2026-06-02-e2e-architecture-alignment-spec.md`
**Goal:** Update the root Playwright E2E suite so it passes against the current self-KB and agent-scoped route architecture without restoring deleted QA APIs.
**Architecture:** Establish a shared E2E context helper that resolves the default agent and builds canonical `/agents/{agentId}/...` paths. Remove stale `qa:*` and `index:*` assumptions from setup and specs, rewrite knowledge/source coverage around current file/source APIs, and add Node type support for E2E TypeScript tooling. Keep production app routing unchanged.
**Tech Stack:** TypeScript, Playwright, FastAPI HTTP APIs, Next.js admin UI, Docker Compose dev stack, Node/npm.

## Planning Notes

- Follow repository guidance in `AGENTS.md` and `CLAUDE.md`: frontend-nextjs is active, root E2E commands use `tests/e2e/playwright.config.ts`, and Docker dev stack is the expected E2E runtime.
- This is a bugfix/test-alignment plan based on proven root-cause investigations from seven debugging subagents.
- Do not reintroduce `POST /api/v1/qa:batch_import` or `GET /api/v1/qa:list`.
- Do not change root route redirect behavior for `/playground`, `/sessions`, or `/qa`.
- Use current canonical routes: `/agents/{agentId}/playground`, `/agents/{agentId}/sessions`, `/agents/{agentId}/files`.
- Current `frontend-nextjs/src/components/ChatPanel.tsx` already exposes the Playground input as `<input type="text" aria-label={t('playground.inputPlaceholder')}>`.
- Current `frontend-nextjs/src/components/AISettingsForm.tsx` already exposes temperature as a native `<input type="range">`.
- Current `frontend-nextjs/src/views/Sessions.tsx` renders the heading from `settings.chatCenter` (`会话中心` / `Sessions Center`).
- Current `frontend-nextjs/src/views/FileUploadManagement.tsx` renders the file management heading from `navigation.fileManagement` and upload section from `files.uploadTitle`.
- `frontend-nextjs/src/services/api.ts` still contains legacy `rebuildIndex` / `getIndexStatus` methods, but backend `backend/api/v1/endpoints.py` does not register `index:rebuild` or `index:status`; E2E tests must not depend on those endpoints.
- The current working tree may contain unrelated deletions or report artifacts. Implementation should start from a reviewed/clean worktree or preserve unrelated changes explicitly.

## Debugging Findings

- Symptom: `npm run test:e2e` smoke run produced 6 failures: QA import/list 404s, Playground controls not found, and Sessions heading not found.
- Reproduction: `npm run test:e2e` against a healthy `docker compose --profile dev` stack. Focused reproductions include `GET /api/v1/qa:list?agent_id=...` returning 404 and `/playground` / `/sessions` redirecting to `/`.
- Root Cause: E2E tests target deleted QA/index endpoints and deprecated root-level routes. Playground/Sessions UI elements exist on the correct agent-scoped pages; tests fail because they never navigate there. Missing `@types/node` is a separate LSP-only issue.
- Fix Strategy: Introduce shared E2E agent context helpers, update global setup and specs to use current routes/APIs, replace stale knowledge tests with current file/source API/UI coverage, and add E2E Node typing.
- Verification: Focused Playwright specs for knowledge, playground, and sessions should pass; `npm run test:e2e` should pass; E2E TypeScript diagnostics for `process` / `Buffer` should disappear.

## File Map

- Create: `tests/e2e/fixtures/e2e-context.ts` — shared E2E constants, API login/default-agent helpers, admin UI login helper, and agent route builder.
- Create: `tests/e2e/.auth/.gitkeep` — keeps the generated auth/context directory available without committing generated JSON.
- Create: `tests/e2e/tsconfig.json` — TypeScript config for E2E files with Node and Playwright types.
- Modify: `tests/e2e/global.setup.ts` — remove stale QA seeding, fail clearly on incompatible existing admin credentials, write resolved agent context for tests.
- Modify: `tests/e2e/playwright.config.ts` — update comments from "seeds QA data" to current setup behavior; keep projects unchanged unless needed for context file output.
- Modify: `tests/e2e/fixtures/admin.fixture.ts` — align login helper with current redirect destinations and reusable context helpers.
- Modify: `tests/e2e/specs/playground-streaming.spec.ts` — navigate to agent-scoped Playground and update brittle assertions.
- Modify: `tests/e2e/specs/sessions-takeover.spec.ts` — navigate to agent-scoped Sessions and reuse shared helpers.
- Modify: `tests/e2e/specs/knowledge-indexing.spec.ts` — replace stale QA/index tests with current file/source API and file management UI coverage.
- Modify: `tests/e2e/specs/recent-commits.spec.ts` — remove stale QA/index references from optional provider regression tests.
- Modify: `package.json` — add E2E typecheck script and Node/TypeScript dev dependencies.
- Modify: `package-lock.json` — lock dependency changes from `npm install`.
- Optional docs update: `E2E_TEST_REPORT.md` — if retained, update status after implementation and ensure secrets remain redacted.

## Parallelization Strategy

Preferred execution model: contract/scaffold first, then parallel leaf batches, then final integration and verification.

| Batch | Tasks | Can Run in Parallel? | Reason |
|-------|-------|----------------------|--------|
| 0 | Task 1, Task 2 | no | shared dependency/config and context helpers used by all later tests |
| 1 | Task 3, Task 4, Task 5, Task 6 | yes | disjoint spec files after shared helpers exist |
| 2 | Task 7 | no | integrates shared config/comments/fixtures and resolves cross-spec consistency |
| 3 | Task 8 | no | final diagnostics and full smoke verification |

## Verification Commands

Run before declaring implementation complete:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm install
npx tsc -p tests/e2e/tsconfig.json --noEmit
npm run test:e2e -- --grep "Knowledge|Playground|Sessions"
npm run test:e2e
```

Also run proactive diagnostics before full verification:

```text
lsp_diagnostics tests/e2e
```

Expected: no `process` / `Buffer` TypeScript errors, focused specs pass, and smoke E2E passes. If frontend source files are changed beyond test-only selectors, also run:

```bash
cd frontend-nextjs && npm run build && npm run typecheck && npm run test
```

---

### Task 1: Add E2E TypeScript Node Tooling

**Purpose:** Remove LSP/TypeScript noise for Node globals in E2E files and provide an explicit root E2E typecheck command.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `no`
- Batch: `0`
- Owns:
  - `package.json`
  - `package-lock.json`
  - `tests/e2e/tsconfig.json`
- Reads:
  - `tests/e2e/playwright.config.ts`
  - `tests/e2e/**/*.ts`
- Must not edit:
  - `frontend-nextjs/package.json`
  - `frontend-nextjs/tsconfig.json`
  - `widget/package.json`
  - `widget/tsconfig.json`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/e2e/tsconfig.json`

**Context for implementer:**
The subagent investigation for BUG-007 confirmed this is a developer-experience issue only. Playwright runs without this, but LSP reports TS2580 for `process` and `Buffer`. Keep root dependencies lightweight and scoped to E2E tooling.

- [ ] **Step 1: Write the failing check**

Run diagnostics before changes:

```text
lsp_diagnostics tests/e2e
```

Expected before implementation: FAIL/diagnostics include `Cannot find name 'process'` and `Cannot find name 'Buffer'`.

Also run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx tsc -p tests/e2e/tsconfig.json --noEmit
```

Expected before implementation: FAIL because `tests/e2e/tsconfig.json` does not exist.

- [ ] **Step 2: Add dependencies and script**

Modify root `package.json` devDependencies and scripts to include:

```json
{
  "scripts": {
    "typecheck:e2e": "tsc -p tests/e2e/tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "^1.59.1",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.2"
  }
}
```

Preserve existing scripts exactly; add the new script without removing `test:e2e*` scripts.

- [ ] **Step 3: Create E2E tsconfig**

Create `tests/e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "@playwright/test"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 4: Install and update lockfile**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm install
```

Expected: `package-lock.json` updates and `node_modules/@types/node` exists.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS or only legitimate type errors unrelated to missing Node globals. If strict mode exposes existing `any`/shape errors, fix the E2E type annotations in the affected test files in the owning tasks, not by disabling strict globally.

Run:

```text
lsp_diagnostics tests/e2e
```

Expected: no `Cannot find name 'process'` or `Cannot find name 'Buffer'` diagnostics.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/e2e/tsconfig.json
git commit -m "test: add e2e TypeScript node tooling"
```

---

### Task 2: Create Shared E2E Agent Context and Fix Global Setup

**Purpose:** Provide a single source of truth for E2E credentials, API base, default agent resolution, admin login, and agent-scoped route construction; remove stale QA seeding from global setup.

**Execution Metadata:**
- Dependencies: `Task 1`
- Parallelizable: `no`
- Batch: `0`
- Owns:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `tests/e2e/.auth/.gitkeep`
  - `tests/e2e/global.setup.ts`
  - `tests/e2e/fixtures/admin.fixture.ts`
- Reads:
  - `tests/e2e/playwright.config.ts`
  - `tests/e2e/specs/*.ts`
  - `backend/api/endpoints/auth.py`
  - `backend/api/v1/endpoints.py`
- Must not edit:
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/specs/sessions-takeover.spec.ts`
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
  - `tests/e2e/specs/recent-commits.spec.ts`

**Files:**
- Create: `tests/e2e/fixtures/e2e-context.ts`
- Create: `tests/e2e/.auth/.gitkeep`
- Modify: `tests/e2e/global.setup.ts`
- Modify: `tests/e2e/fixtures/admin.fixture.ts`

**Context for implementer:**
Global setup currently contains a commented-out QA seed block and a stale implementation note. Remove that block entirely. Setup must fail clearly when an existing persistent database has a different admin account/password instead of silently continuing.

- [ ] **Step 1: Write the failing check**

Run before changes:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e -- --grep "Playground|Sessions" --project=smoke
```

Expected before implementation: FAIL because tests navigate to root routes and/or helpers do not expose agent context. This establishes the behavior that later tasks will fix.

- [ ] **Step 2: Add shared context helper**

Create `tests/e2e/fixtures/e2e-context.ts` with these exported contracts:

```ts
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';
export const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';
export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export type E2EAgentContext = {
  agentId: string;
  adminEmail: string;
  apiBaseUrl: string;
  baseUrl: string;
};

export function loginHeaders(): Record<string, string> {
  return { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
}

export function agentRoute(agentId: string, page: 'dashboard' | 'playground' | 'sessions' | 'files' | 'urls' | 'settings/agent'): string {
  return `/agents/${agentId}/${page}`;
}

export async function loginByApi(request: APIRequestContext): Promise<string> {
  const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
    headers: loginHeaders(),
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.status(), await loginRes.text()).toBe(200);
  const data = await loginRes.json() as { access_token: string };
  return data.access_token;
}

export async function getDefaultAgent(request: APIRequestContext, token: string): Promise<{ id: string; [key: string]: unknown }> {
  const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(agentRes.status(), await agentRes.text()).toBe(200);
  const agent = await agentRes.json() as { id?: string; [key: string]: unknown };
  expect(agent.id).toBeTruthy();
  return agent as { id: string; [key: string]: unknown };
}

export async function resolveAgentContext(request: APIRequestContext): Promise<E2EAgentContext> {
  const token = await loginByApi(request);
  const agent = await getDefaultAgent(request, token);
  return { agentId: agent.id, adminEmail: ADMIN_EMAIL, apiBaseUrl: API_BASE, baseUrl: BASE_URL };
}

export async function adminLogin(page: Page): Promise<void> {
  await page.route('**/api/admin/login', async (route) => {
    await route.continue({ headers: { ...route.request().headers(), ...loginHeaders() } });
  });
  await page.goto('/login');
  await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/\/login/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBeTruthy();
}
```

If strict typechecking requires narrower types, refine annotations without changing helper behavior.

- [ ] **Step 3: Update admin fixture to delegate to shared helper**

Modify `tests/e2e/fixtures/admin.fixture.ts` to import `adminLogin` and `agentRoute` from `./e2e-context` or re-export them. Remove the old `waitForURL(/\/(dashboard|playground)/)` expectation because current successful login may land on `/` or agent selector/dashboard depending on role and state.

- [ ] **Step 4: Fix global setup**

Modify `tests/e2e/global.setup.ts`:

- Keep admin registration attempt.
- If registration returns `403`, allow setup to continue only if login succeeds with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- On login failure, throw a clear message:
  ```ts
  throw new Error(`Admin login failed with E2E credentials after registration status ${registerRes.status}. Reset the test database or set ADMIN_EMAIL/ADMIN_PASSWORD for the existing admin.`);
  ```
- Fetch `/api/v1/agent:default` and validate `agent.id`.
- Keep the Jina key setup if needed, but do not seed QA.
- Remove the commented QA block and remove the stale implementation note.
- Optionally write `tests/e2e/.auth/e2e-context.json` with `{ agentId, adminEmail, apiBaseUrl }` for debugging; do not require tests to read it if helper functions resolve context via API.

- [ ] **Step 5: Verify setup**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke --list
```

Expected: typecheck passes; test listing passes; global setup has no QA seeding call.

Search to verify stale setup references are gone:

```bash
cd /Users/yi/Documents/Projects/basjoo
grep -R "qa:batch_import\|qa:list\|Implement QA" tests/e2e/global.setup.ts tests/e2e/fixtures || true
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/fixtures/e2e-context.ts tests/e2e/.auth/.gitkeep tests/e2e/global.setup.ts tests/e2e/fixtures/admin.fixture.ts
git commit -m "test: add shared e2e agent context"
```

---

### Task 3: Update Playground E2E to Agent-Scoped Route

**Purpose:** Fix Playground tests so they reach the real Playground page and assert current UI/API behavior instead of failing on the AgentPanel redirect page.

**Execution Metadata:**
- Dependencies: `Task 2`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `tests/e2e/specs/playground-streaming.spec.ts`
- Reads:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `frontend-nextjs/src/components/ChatPanel.tsx`
  - `frontend-nextjs/src/components/AISettingsForm.tsx`
  - `frontend-nextjs/src/views/Playground.tsx`
- Must not edit:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `tests/e2e/specs/sessions-takeover.spec.ts`
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
  - frontend source files unless a selector is proven impossible to use from the current DOM

**Files:**
- Modify/Test: `tests/e2e/specs/playground-streaming.spec.ts`

**Context for implementer:**
BUG-004 and BUG-005 are not independent UI bugs. The chat textbox and temperature range input exist on `/agents/{agentId}/playground`. The route is the fix. Avoid adding frontend `data-testid` unless browser inspection proves accessible selectors cannot work.

- [ ] **Step 1: Write/update failing test path expectation**

Modify `beforeEach` to resolve agent context and navigate to the agent-scoped route:

```ts
import { adminLogin, agentRoute, resolveAgentContext } from '../fixtures/e2e-context';

test.beforeEach(async ({ page, request }) => {
  const context = await resolveAgentContext(request);
  await adminLogin(page);
  await page.goto(agentRoute(context.agentId, 'playground'));
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(`/agents/${context.agentId}/playground`));
});
```

Run focused test before completing other assertion changes:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts -g "auto-save"
```

Expected at this intermediate point: it should no longer fail because page is AgentPanel; it may fail on a brittle temperature text assertion.

- [ ] **Step 2: Update auto-save assertion to current UI**

Keep the selector for the range input, but assert the label contains the new value rather than requiring a single text node with parentheses across the page:

```ts
const tempInput = page.locator('input[type="range"]').first();
await expect(tempInput).toBeVisible({ timeout: 10_000 });

const previousValue = Number(await tempInput.evaluate((input: HTMLInputElement) => input.value));
const delta = previousValue >= 2 ? -0.1 : 0.1;
const saveResponse = page.waitForResponse((response) =>
  response.url().includes('/api/v1/agent?') &&
  response.request().method() === 'PUT' &&
  response.status() === 200,
);

await tempInput.focus();
await tempInput.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');
await saveResponse;

const currentValue = await tempInput.evaluate((input: HTMLInputElement) => input.value);
await expect(page.locator('label').filter({ hasText: /温度|temperature/i }).first()).toContainText(currentValue, { timeout: 5_000 });
```

- [ ] **Step 3: Keep chat input selector, make response assertion robust**

Use the existing accessible selector:

```ts
const messageInput = page.getByRole('textbox', { name: /输入您的问题|your question/i });
await expect(messageInput).toBeVisible({ timeout: 10_000 });
```

For send/clear tests, assert externally visible behavior that is stable:

- User message appears after send.
- Send button can be clicked.
- Either assistant content appears or a user-visible error/status appears if provider configuration fails.
- Clear action removes the unique user message.

Use unique messages to avoid matching prior state:

```ts
const uniqueMessage = `E2E playground ${Date.now()}`;
await messageInput.fill(uniqueMessage);
await page.getByRole('button', { name: /发送|send/i }).click();
await expect(page.getByText(uniqueMessage, { exact: true })).toBeVisible({ timeout: 5_000 });
```

If the current UI requires a deterministic assistant assertion, prefer a locator scoped to the transcript over a generic `/hello|help/` regex.

- [ ] **Step 4: Run focused Playground tests**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/playground-streaming.spec.ts
```

Expected: all Playground tests pass or fail only on a provider/network issue that is clearly asserted as a controlled error path. They must not land on `AgentPanel`.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/specs/playground-streaming.spec.ts
git commit -m "test: route playground e2e through agent context"
```

---

### Task 4: Update Sessions E2E to Agent-Scoped Route

**Purpose:** Fix the Sessions UI test so it opens the real Sessions page and verifies the API-created session appears there.

**Execution Metadata:**
- Dependencies: `Task 2`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `tests/e2e/specs/sessions-takeover.spec.ts`
- Reads:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `frontend-nextjs/src/views/Sessions.tsx`
  - `frontend-nextjs/src/locales/zh-CN/common.json`
  - `frontend-nextjs/src/locales/en-US/common.json`
- Must not edit:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/specs/knowledge-indexing.spec.ts`

**Files:**
- Modify/Test: `tests/e2e/specs/sessions-takeover.spec.ts`

**Context for implementer:**
The API takeover chain already passed. Preserve it. Only the UI test fails because it navigates to `/sessions`, which redirects to `/`.

- [ ] **Step 1: Update imports and helper usage**

Import shared helpers:

```ts
import { adminLogin, agentRoute, API_BASE, loginByApi, getDefaultAgent } from '../fixtures/e2e-context';
```

Remove duplicated `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `API_BASE`, and `loginHeaders` if fully replaced by shared helpers. If retaining local helpers, do not duplicate conflicting constants.

- [ ] **Step 2: Update UI navigation**

Replace the login and root navigation block in `sessions page shows visitor sessions after login` with:

```ts
await adminLogin(page);
await page.goto(agentRoute(agent.id, 'sessions'));
await page.waitForLoadState('networkidle');
await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}/sessions`));
```

- [ ] **Step 3: Keep semantic heading and session assertions**

The heading assertion is valid on the correct page:

```ts
await expect(page.getByRole('heading', { name: /会话中心|sessions/i })).toBeVisible({ timeout: 10_000 });
await expect(page.getByText(new RegExp(`会话 #${sessionId}|Session #${sessionId}`))).toBeVisible({ timeout: 10_000 });
```

Use a bilingual regex for the session row because English locale renders `Session #{{id}}`.

- [ ] **Step 4: Run focused Sessions tests**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/sessions-takeover.spec.ts
```

Expected: both Sessions tests pass. The UI test must not show `智能体面板` / AgentPanel in failure screenshots.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/specs/sessions-takeover.spec.ts
git commit -m "test: route sessions e2e through agent context"
```

---

### Task 5: Rewrite Knowledge E2E Around Current Source APIs

**Purpose:** Replace obsolete QA import/list/index tests with current knowledge/source API and agent-scoped file management UI coverage.

**Execution Metadata:**
- Dependencies: `Task 2`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
- Reads:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `frontend-nextjs/src/views/FileUploadManagement.tsx`
  - `frontend-nextjs/src/services/api.ts`
  - `backend/api/v1/endpoints.py`
- Must not edit:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/specs/sessions-takeover.spec.ts`
  - `backend/api/v1/endpoints.py`

**Files:**
- Modify/Test: `tests/e2e/specs/knowledge-indexing.spec.ts`

**Context for implementer:**
This spec currently has two stale QA tests. Rewrite the file instead of patching the old endpoint names. Use current endpoints that are registered: `files:list`, `sources:summary`, and `tasks:status`. Avoid `qa:*`, `index:rebuild`, and `index:status`.

- [ ] **Step 1: Verify RED from stale tests**

Run before changes:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/knowledge-indexing.spec.ts
```

Expected before implementation: FAIL with 404 from `qa:batch_import` / `qa:list` or stale index endpoint failures.

- [ ] **Step 2: Replace describe block and imports**

Change the file header to reflect current behavior:

```ts
/**
 * E2E smoke test: current knowledge source APIs and file management UI.
 *
 * @smoke @prod
 */
import { test, expect } from '@playwright/test';
import { adminLogin, agentRoute, API_BASE, resolveAgentContext, loginByApi, getDefaultAgent } from '../fixtures/e2e-context';
```

Rename describe to:

```ts
test.describe('Knowledge Source Flow', () => {
```

- [ ] **Step 3: Add API shape test for current source contracts**

Replace `QA import and index rebuild` with:

```ts
test('source summary and file list APIs expose current knowledge state', async ({ request }) => {
  const token = await loginByApi(request);
  const agent = await getDefaultAgent(request, token);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const filesRes = await request.get(`${API_BASE}/api/v1/files:list?agent_id=${agent.id}&skip=0&limit=10`, {
    headers: authHeaders,
  });
  expect(filesRes.status(), await filesRes.text()).toBe(200);
  const filesData = await filesRes.json() as { files: unknown[]; total: number };
  expect(Array.isArray(filesData.files)).toBe(true);
  expect(typeof filesData.total).toBe('number');

  const summaryRes = await request.get(`${API_BASE}/api/v1/sources:summary?agent_id=${agent.id}`, {
    headers: authHeaders,
  });
  expect(summaryRes.status(), await summaryRes.text()).toBe(200);
  const summary = await summaryRes.json() as {
    urls: { total: number; indexed: number; pending: number; total_size_kb: number };
    files: { total: number; ready: number; processing: number; total_size_kb: number };
    has_pending: boolean;
  };
  expect(typeof summary.urls.total).toBe('number');
  expect(typeof summary.urls.indexed).toBe('number');
  expect(typeof summary.files.total).toBe('number');
  expect(typeof summary.files.ready).toBe('number');
  expect(typeof summary.has_pending).toBe('boolean');
});
```

- [ ] **Step 4: Add file management UI test for agent-scoped page**

Replace `QA management UI shows imported items` with:

```ts
test('file management UI loads for the selected agent', async ({ page, request }) => {
  const context = await resolveAgentContext(request);
  await adminLogin(page);
  await page.goto(agentRoute(context.agentId, 'files'));
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(`/agents/${context.agentId}/files`));

  await expect(page.getByRole('heading', { name: /文件上传|file upload/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /上传文件|upload/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/文件列表|file list/i)).toBeVisible({ timeout: 10_000 });
});
```

If English uses a different file-management heading, inspect `frontend-nextjs/src/locales/en-US/common.json` and update the regex while keeping the assertion semantic.

- [ ] **Step 5: Verify no stale endpoints remain in this spec**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
grep -n "qa:\|index:rebuild\|index:status" tests/e2e/specs/knowledge-indexing.spec.ts || true
```

Expected: no output.

- [ ] **Step 6: Run focused Knowledge tests**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/knowledge-indexing.spec.ts
```

Expected: both Knowledge Source Flow tests pass without external provider dependency.

- [ ] **Step 7: Run typecheck**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/specs/knowledge-indexing.spec.ts
git commit -m "test: align knowledge e2e with source APIs"
```

---

### Task 6: Remove Stale QA/Index References from Recent Regression Tests

**Purpose:** Ensure skipped/opt-in provider regression tests do not still target deleted QA and index endpoints when provider keys are supplied.

**Execution Metadata:**
- Dependencies: `Task 2`
- Parallelizable: `yes`
- Batch: `1`
- Owns:
  - `tests/e2e/specs/recent-commits.spec.ts`
- Reads:
  - `tests/e2e/fixtures/e2e-context.ts`
  - `backend/api/v1/endpoints.py`
  - `frontend-nextjs/src/services/api.ts`
- Must not edit:
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
  - `tests/e2e/specs/playground-streaming.spec.ts`
  - `tests/e2e/specs/sessions-takeover.spec.ts`

**Files:**
- Modify/Test: `tests/e2e/specs/recent-commits.spec.ts`

**Context for implementer:**
The test `SiliconFlow embedding can rebuild QA index and retrieve context` is skipped unless `E2E_SILICONFLOW_API_KEY` is set, but it will fail if enabled because it calls `qa:batch_import`, `index:rebuild`, and `index:status`. Keep provider key save/mask/test coverage; remove stale QA indexing coverage.

- [ ] **Step 1: Verify stale references**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
grep -n "qa:batch_import\|index:rebuild\|index:status\|waitForIndex" tests/e2e/specs/recent-commits.spec.ts
```

Expected before implementation: output includes stale endpoint references.

- [ ] **Step 2: Replace stale SiliconFlow indexing test**

Remove `waitForIndex` if no other test needs it.

Rename the stale test to:

```ts
test('SiliconFlow embedding key can be saved and validated without legacy QA index', async ({ request }) => {
```

Keep the existing skip guard:

```ts
test.skip(!SILICONFLOW_API_KEY, 'SiliconFlow test key is required');
```

Use current behavior:

```ts
const updated = await updateAgent(request, token, agent.id, {
  embedding_provider: 'siliconflow',
  embedding_model: 'BAAI/bge-m3',
  siliconflow_api_key: SILICONFLOW_API_KEY,
});
expect(updated.embedding_provider).toBe('siliconflow');
expect(updated.siliconflow_api_key_set).toBe(true);
expect(JSON.stringify(updated)).not.toContain(SILICONFLOW_API_KEY);

const testRes = await request.post(`${API_BASE}/api/v1/agent:test-embedding-api?agent_id=${agent.id}`, {
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  data: {
    embedding_provider: 'siliconflow',
    embedding_model: 'BAAI/bge-m3',
    siliconflow_api_key: SILICONFLOW_API_KEY,
  },
});
expect(testRes.status(), await testRes.text()).toBe(200);
await expect(testRes.json()).resolves.toMatchObject({ success: true });

const summaryRes = await request.get(`${API_BASE}/api/v1/sources:summary?agent_id=${agent.id}`, {
  headers: { Authorization: `Bearer ${token}` },
});
expect(summaryRes.status(), await summaryRes.text()).toBe(200);
```

This preserves provider validation coverage without claiming QA retrieval behavior.

- [ ] **Step 3: Update helper imports or constants only if needed**

This file already has local helpers. To minimize churn, it may keep them. If importing shared `API_BASE`, `loginByApi`, or `getDefaultAgent`, remove duplicate local definitions in the same edit.

- [ ] **Step 4: Verify no stale references remain**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
grep -n "qa:batch_import\|index:rebuild\|index:status\|waitForIndex" tests/e2e/specs/recent-commits.spec.ts || true
```

Expected: no output.

- [ ] **Step 5: Run focused non-provider recent-commits tests**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/recent-commits.spec.ts
```

Expected: non-provider tests pass; provider-key tests remain skipped unless required env vars are set.

If provider env vars are available, also run:

```bash
E2E_SILICONFLOW_API_KEY="$E2E_SILICONFLOW_API_KEY" npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/recent-commits.spec.ts -g "SiliconFlow embedding key"
```

Expected: PASS when key is valid.

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/specs/recent-commits.spec.ts
git commit -m "test: remove legacy qa index provider regression"
```

---

### Task 7: Integrate E2E Config, Comments, and Cross-Spec Consistency

**Purpose:** Reconcile shared helper usage across specs/config, update misleading comments, and ensure no stale QA/index/root-route assumptions remain in the E2E suite.

**Execution Metadata:**
- Dependencies: `Task 3`, `Task 4`, `Task 5`, `Task 6`
- Parallelizable: `no`
- Batch: `2`
- Owns:
  - `tests/e2e/playwright.config.ts`
  - `tests/e2e/specs/*.ts`
  - `tests/e2e/fixtures/*.ts`
- Reads:
  - `docs/specs/2026-06-02-e2e-architecture-alignment-spec.md`
  - `E2E_TEST_REPORT.md`
  - `frontend-nextjs/app/(dashboard)/**/page.tsx`
- Must not edit:
  - backend source files
  - frontend source files

**Files:**
- Modify: `tests/e2e/playwright.config.ts`
- Modify if needed: `tests/e2e/specs/*.ts`
- Modify if needed: `tests/e2e/fixtures/*.ts`

**Context for implementer:**
This is the fan-in task. Do not rework already-passing leaf specs except to resolve naming/import consistency, remove duplicate helpers, or fix typecheck issues.

- [ ] **Step 1: Update Playwright config comments**

Modify `tests/e2e/playwright.config.ts` comment:

From:

```ts
// Global setup runs once before all tests: seeds admin + QA data
```

To:

```ts
// Global setup runs once before all tests: ensures admin login works and default agent context exists
```

The `apiBaseUrl` variable is currently declared but unused. Either remove it or use it in comments/config if a future helper needs it. Prefer removing unused code if `npm run typecheck:e2e` flags it.

- [ ] **Step 2: Search and remove stale endpoint assumptions**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
grep -R "qa:batch_import\|qa:list\|index:rebuild\|index:status" tests/e2e || true
```

Expected after leaf tasks: no output. If output remains, update the owning spec to current API behavior.

- [ ] **Step 3: Search and review deprecated root route navigation**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
grep -R "page.goto('/playground'\|page.goto('/sessions'\|page.goto('/qa'" tests/e2e || true
```

Expected: no output unless a test explicitly asserts redirect behavior. If an explicit redirect test exists, its name must include "redirect" and its assertion must expect `/` or `/files`, not operational UI.

- [ ] **Step 4: Run integrated E2E typecheck**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS.

- [ ] **Step 5: Run focused integration subset**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/knowledge-indexing.spec.ts tests/e2e/specs/playground-streaming.spec.ts tests/e2e/specs/sessions-takeover.spec.ts tests/e2e/specs/recent-commits.spec.ts
```

Expected: PASS for non-provider tests; provider-key tests skipped unless env vars are supplied.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/playwright.config.ts tests/e2e/specs tests/e2e/fixtures
git commit -m "test: integrate e2e architecture alignment"
```

---

### Task 8: Final Verification and Evidence Update

**Purpose:** Prove the full smoke suite is aligned with the current architecture and document final results.

**Execution Metadata:**
- Dependencies: `Task 7`
- Parallelizable: `no`
- Batch: `3`
- Owns:
  - `E2E_TEST_REPORT.md` if retained/updated
  - no source files unless verification reveals a missed issue that must be fixed in its owning task
- Reads:
  - `docs/specs/2026-06-02-e2e-architecture-alignment-spec.md`
  - `docs/plans/2026-06-02-e2e-architecture-alignment-implementation-plan.md`
  - `test-results/`
  - `tests/playwright-report/`
- Must not edit:
  - source/test files from Tasks 1-7 except by returning to the owning task with a clear failure

**Files:**
- Optional Modify: `E2E_TEST_REPORT.md`

**Context for implementer:**
This task verifies, it does not invent new fixes. If a verification command fails, return to the responsible prior task and update that task's implementation, then rerun this task.

- [ ] **Step 1: Ensure dev stack is healthy**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
docker compose --profile dev up -d --build
```

Then check:

```bash
cd /Users/yi/Documents/Projects/basjoo
docker compose --profile dev ps
```

Expected: backend-dev healthy, frontend-dev running, redis healthy, scrapling healthy. If Qdrant compose health reports unhealthy but `http://localhost:6333/healthz` responds, note that separately; do not block unrelated E2E unless KB tests require Qdrant.

- [ ] **Step 2: Run proactive diagnostics**

Run:

```text
lsp_diagnostics tests/e2e
```

Expected: no `process` / `Buffer` diagnostics. Any remaining diagnostics must be triaged as real type issues or documented as non-blocking with evidence.

- [ ] **Step 3: Run root E2E typecheck**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run typecheck:e2e
```

Expected: PASS.

- [ ] **Step 4: Run focused smoke subset**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e -- --grep "Knowledge|Playground|Sessions"
```

Expected: PASS. This verifies the originally failing areas.

- [ ] **Step 5: Run full smoke suite**

Run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e
```

Expected: PASS for all non-skipped smoke tests. Provider-key tests may remain skipped when their env vars are absent.

- [ ] **Step 6: Optional broader E2E projects**

If the environment supports nginx/prod-like and widget cross-origin checks, run:

```bash
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e:prod
npm run test:e2e:widget
```

Expected: PASS or documented environment-specific skip/blocker. Do not treat unsupported local host-page setup as a product regression without evidence.

- [ ] **Step 7: Update evidence report if retained**

If keeping `E2E_TEST_REPORT.md`, update it with:

- New test command outputs.
- Confirmation that `qa:*` failures were resolved by removing stale test assumptions.
- Confirmation that Playground/Sessions failures were resolved by agent-scoped navigation.
- Confirmation that Node type diagnostics are resolved.
- No raw API keys or secrets.

- [ ] **Step 8: Final commit**

```bash
git add E2E_TEST_REPORT.md docs/specs/2026-06-02-e2e-architecture-alignment-spec.md docs/plans/2026-06-02-e2e-architecture-alignment-implementation-plan.md
git commit -m "docs: record e2e architecture alignment"
```

If the spec/plan/report were already committed earlier, only commit updated evidence files.
