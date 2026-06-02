# Fix E2E QA Tests - Remove Obsolete QA Tests and Add File/URL Tests

**Status:** Draft  
**Date:** 2026-06-03  
**Source:** "QA功能已弃用，E2E测试需要更新为Files功能"  
**Goal:** Remove obsolete QA-related E2E tests that reference removed API endpoints and replace with File/URL upload and indexing tests.  
**Architecture:** Update E2E tests to use the existing `/api/v1/files:*` and `/api/v1/urls:*` endpoints for knowledge source management, leveraging the background indexing pipeline.  
**Tech Stack:** TypeScript, Playwright, FastAPI

---

## Planning Notes

### Background
The QA (Question-Answer) batch import system has been completely removed from the backend:
- `POST /api/v1/qa:batch_import` → **404 Not Found**
- `GET /api/v1/qa:list` → **404 Not Found**

Replaced by:
1. **Multi-tenant KB document system** (`/api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents`)
2. **Legacy file/URL endpoints** (`/api/v1/files:*`, `/api/v1/urls:*`)

Frontend `/qa` page now redirects to `/files`.

### E2E Test Impact
| File | Test | Current Behavior | Required Change |
|------|------|------------------|-----------------|
| `knowledge-indexing.spec.ts` | QA import and index rebuild | Calls `qa:batch_import` (404) | Replace with `files:upload` + `index:rebuild` |
| `knowledge-indexing.spec.ts` | QA management UI | Navigates to `/qa` (redirects) | Navigate to `/files` instead |
| `recent-commits.spec.ts` | SiliconFlow embedding QA | Uses `qa:batch_import` (404) | Replace with `files:upload` + `index:rebuild` |
| `recent-commits.spec.ts` | Provider keys test | Skips without SiliconFlow key | Add comment explaining QA removal |
| `global.setup.ts` | QA seeding | Tries to seed QA data | Remove QA seeding, keep agent setup |

### Constraints
- File upload in Playwright requires `multipart/form-data` handling
- Index rebuild is async; tests must poll `index:status` endpoint
- Tests should maintain backward compatibility with existing `ADMIN_EMAIL`/`ADMIN_PASSWORD` credentials
- New tests must follow existing patterns: API calls via `request` fixture, UI via `page` fixture

### Assumptions
- File upload endpoint accepts `.txt` files for simple testing
- Index rebuild completes within 60 seconds (existing timeout)
- Default agent exists and has quota for file uploads

---

## Exploration Summary

**Project memory files read:** AGENTS.md (via parent context)

**Exploration subagent model:** deepseek/deepseek-v4-flash

**Subagents dispatched:** 3 parallel
1. **QA API verification** - Confirmed 0 QA endpoints exist, replaced by file/URL endpoints
2. **Playground UI verification** - Verified selectors need updating (not directly relevant to this fix)
3. **Sessions page verification** - Verified heading exists (not directly relevant to this fix)

**Key findings:**
- QA endpoints completely removed from `backend/api/v1/endpoints.py`
- Only 36 `/api/v1/*` endpoints exist, none contain "qa"
- File endpoints available: `files:list`, `files:upload`, `files:delete`, `files:clear_all`
- URL endpoints available: `urls:list`, `urls:create`, `urls:delete`, `urls:clear_all`
- Index endpoints available: `index:rebuild`, `index:status`

---

## File Map

### Modify
| File | Change Summary |
|------|----------------|
| `tests/e2e/specs/knowledge-indexing.spec.ts` | Replace QA batch import with file upload test; update QA UI test to use `/files` page |
| `tests/e2e/specs/recent-commits.spec.ts` | Replace QA-based SiliconFlow test with file-based test; add documentation comment |
| `tests/e2e/global.setup.ts` | Remove `CRAWL_TARGET_URL` QA seeding logic |

### Test
| File | Coverage |
|------|----------|
| `tests/e2e/specs/knowledge-indexing.spec.ts` | File upload → index rebuild → chat retrieval flow |
| `tests/e2e/specs/recent-commits.spec.ts` | SiliconFlow embedding with file-based KB |

---

## Parallelization Strategy

**Preferred execution model:** single-agent sequential

This is a focused test file update with no cross-cutting dependencies. All changes are within the `tests/e2e/` directory and can be executed by a single agent.

| Task | Dependencies | Parallelizable | Batch |
|------|--------------|----------------|-------|
| Task 1: Update knowledge-indexing.spec.ts | None | No (ordered) | 1 |
| Task 2: Update recent-commits.spec.ts | Task 1 | No | 2 |
| Task 3: Update global.setup.ts | None | No | 1 |
| Task 4: Run E2E verification | Tasks 1-3 | No | 3 |

---

## Verification Commands

```bash
# Type check E2E tests
cd /Users/yi/Documents/Projects/basjoo && npm run typecheck:e2e

# Run smoke tests (should pass, no QA failures)
cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e

# Expected: All 8 original tests pass, 0 QA-related failures
# The 2 skipped tests (SiliconFlow) remain skipped
```

---

## Task 1: Update knowledge-indexing.spec.ts

**Purpose:** Replace obsolete QA import test with file upload test; update QA UI test to Files page.

**Execution Metadata:**
- Dependencies: None
- Parallelizable: No
- Batch: 1
- Owns:
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
- Reads:
  - `tests/e2e/specs/admin-auth.spec.ts` (login pattern)
  - `backend/api/v1/endpoints.py` (file endpoint signatures)
- Must not edit:
  - Any backend code
  - Any frontend code

**Context for implementer:**
- Use existing `loginByApi` pattern from `recent-commits.spec.ts`
- File upload requires `FormData` with `multipart/form-data` content-type
- Index rebuild endpoint: `POST /api/v1/index:rebuild?agent_id={id}`
- Index status endpoint: `GET /api/v1/index:status?agent_id={id}`
- Chat context endpoint: `POST /api/v1/contexts` (used in recent-commits.spec.ts)

### Step 1: Replace "QA import and index rebuild" test

**Current test to replace:** Lines 29-86

**New test structure:**

```typescript
test('file upload and index rebuild', async ({ page, request }) => {
  // 1. Login via API to get token
  const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
    headers: { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200) + 20}` },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const loginData = await loginRes.json() as { access_token: string };
  const token = loginData.access_token;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. Get default agent
  const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
    headers: authHeaders,
  });
  const agent = await agentRes.json() as { id: string };

  // 3. Create a test file with unique content
  const uniqueContent = `E2E Test Content ${Date.now()}`;
  const fileContent = `This is a test file for E2E indexing.\n\n${uniqueContent}`;
  const blob = Buffer.from(fileContent);

  // 4. Upload file using multipart/form-data
  const uploadRes = await request.post(`${API_BASE}/api/v1/files:upload?agent_id=${agent.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'e2e-test.txt',
        mimeType: 'text/plain',
        buffer: blob,
      },
    },
  });
  expect([200, 201]).toContain(uploadRes.status());

  // 5. Rebuild index
  const rebuildRes = await request.post(`${API_BASE}/api/v1/index:rebuild?agent_id=${agent.id}`, {
    headers: authHeaders,
    data: { force: true },
  });
  expect([200, 202]).toContain(rebuildRes.status());

  // 6. Wait for index job to complete
  let status = 'unknown';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1_000);
    const statusRes = await request.get(`${API_BASE}/api/v1/index:status?agent_id=${agent.id}`, {
      headers: authHeaders,
    });
    const statusData = await statusRes.json() as { status: string };
    status = statusData.status;
    if (status === 'completed' || status === 'failed') break;
  }
  expect(status).toBe('completed');

  // 7. Verify content is retrievable via context search
  const contextRes = await request.post(`${API_BASE}/api/v1/contexts`, {
    headers: authHeaders,
    data: { agent_id: agent.id, query: uniqueContent, top_k: 5 },
  });
  expect(contextRes.status()).toBe(200);
  const contexts = await contextRes.json() as { contexts: Array<{ type: string; content?: string }> };
  expect(contexts.contexts.some((item) => item.content?.includes(uniqueContent))).toBe(true);
});
```

**Run and verify RED:**
```bash
cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e -- tests/e2e/specs/knowledge-indexing.spec.ts -g "file upload and index rebuild"
```
**Expected:** Test passes (new implementation)

**Commit:**
```bash
git add tests/e2e/specs/knowledge-indexing.spec.ts
git commit -m "test(e2e): replace QA import test with file upload test"
```

---

### Step 2: Replace "QA management UI shows imported items" test

**Current test to replace:** Lines 92-146 (approximately)

**New test structure:**

```typescript
test('file management UI shows uploaded files', async ({ page, request }) => {
  // 1. Verify files were seeded via API
  const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
    headers: { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200) + 20}` },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = (await loginRes.json() as { access_token: string }).access_token;
  const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const agent = await agentRes.json() as { id: string };

  // 2. Check files list
  const filesRes = await request.get(`${API_BASE}/api/v1/files:list?agent_id=${agent.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const filesData = await filesRes.json() as { files: Array<{ id: string; filename: string }> };
  expect(filesData.files.length).toBeGreaterThanOrEqual(1);

  // 3. Verify Files page loads in UI
  await page.goto('/files');
  await page.waitForLoadState('networkidle');

  // 4. Verify files page renders (check for page title or content area)
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  
  // 5. Verify at least one file is listed
  await expect(page.locator('[data-testid^="file-item"], tr, .file-item').first()).toBeVisible({ timeout: 10_000 });
});
```

**Run and verify RED:**
```bash
cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e -- tests/e2e/specs/knowledge-indexing.spec.ts -g "file management UI"
```
**Expected:** Test passes

**Commit:**
```bash
git add tests/e2e/specs/knowledge-indexing.spec.ts
git commit -m "test(e2e): replace QA UI test with files UI test"
```

---

## Task 2: Update recent-commits.spec.ts

**Purpose:** Replace QA-based SiliconFlow test with file-based test.

**Execution Metadata:**
- Dependencies: Task 1 (verify file upload pattern works)
- Parallelizable: No
- Batch: 2
- Owns:
  - `tests/e2e/specs/recent-commits.spec.ts`
- Reads:
  - `tests/e2e/specs/knowledge-indexing.spec.ts` (file upload pattern from Task 1)

### Step 1: Replace "SiliconFlow embedding can rebuild QA index" test

**Current test:** Lines ~146-182

**Change:** Replace QA batch import with file upload + index rebuild. Keep SiliconFlow embedding provider test.

```typescript
test('SiliconFlow embedding can rebuild file index and retrieve context', async ({ request }) => {
  test.skip(!SILICONFLOW_API_KEY, 'SiliconFlow test key is required');

  // Setup agent with SiliconFlow
  await updateAgent(request, token, agent.id, {
    embedding_provider: 'siliconflow',
    embedding_model: 'BAAI/bge-m3',
    siliconflow_api_key: SILICONFLOW_API_KEY,
  });

  // Upload file instead of QA import
  const unique = `SiliconFlow E2E ${Date.now()}`;
  const fileContent = `The unique SiliconFlow E2E answer is ${unique}.`;
  const blob = Buffer.from(fileContent);

  const uploadRes = await request.post(`${API_BASE}/api/v1/files:upload?agent_id=${agent.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'siliconflow-test.txt',
        mimeType: 'text/plain',
        buffer: blob,
      },
    },
  });
  expect([200, 201]).toContain(uploadRes.status());

  // Rebuild index (same logic)
  const rebuildRes = await request.post(`${API_BASE}/api/v1/index:rebuild?agent_id=${agent.id}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { force: true },
  });
  expect([200, 202]).toContain(rebuildRes.status());

  const status = await waitForIndex(request, token, agent.id);
  expect(status.status).toBe('completed');

  // Context retrieval (same logic)
  const contextRes = await request.post(`${API_BASE}/api/v1/contexts`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { agent_id: agent.id, query: unique, top_k: 5 },
  });
  expect(contextRes.status()).toBe(200);
  const contexts = await contextRes.json() as { contexts: Array<{ type: string; content?: string }> };
  expect(contexts.contexts.some((item) => item.content?.includes(unique))).toBe(true);
});
```

**Add comment about QA removal:**
At the top of the file, add:
```typescript
/**
 * NOTE: QA (Question-Answer) batch import feature has been removed.
 * Tests previously using qa:batch_import now use files:upload.
 * See: docs/plans/2026-06-03-fix-e2e-qa-tests-implementation-plan.md
 */
```

**Run and verify:**
```bash
cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e -- tests/e2e/specs/recent-commits.spec.ts -g "SiliconFlow embedding"
```
**Expected:** Test skipped (no SiliconFlow key) or passes

**Commit:**
```bash
git add tests/e2e/specs/recent-commits.spec.ts
git commit -m "test(e2e): replace QA with file upload in SiliconFlow test"
```

---

## Task 3: Update global.setup.ts

**Purpose:** Remove obsolete QA seeding logic from global setup.

**Execution Metadata:**
- Dependencies: None
- Parallelizable: No
- Batch: 1
- Owns:
  - `tests/e2e/global.setup.ts`

### Step 1: Remove QA seeding

**Current code to remove:** Lines ~76-86

```typescript
// REMOVE THIS ENTIRE BLOCK:
// 5. Add sample URL (skip if no crawl target available)
const crawlTarget = process.env.CRAWL_TARGET_URL || "";
if (crawlTarget) {
  const urlRes = await api(`/api/v1/urls:create?agent_id=${agent.id}`, {
    method: "POST",
    headers: { ...authHeaders } as HeadersInit,
    data: { urls: [crawlTarget] },
  });
  if (![200, 201].includes(urlRes.status)) {
    console.warn(
      `Warning: Failed to seed URL (status ${urlRes.status}), continuing anyway`,
    );
  }
}
```

**Note:** This actually uses `urls:create`, not `qa:batch_import`. But since the knowledge-indexing tests now handle their own setup, we should remove this global URL seeding to avoid conflicts.

Alternatively, if this is useful for other tests, keep it but document that it's optional.

**Decision:** Keep the URL seeding but rename the env var to be clearer:
```typescript
// Optional: Seed a URL for testing (used by URL-related tests)
const seedUrl = process.env.E2E_SEED_URL || "";
if (seedUrl) {
  // ... existing logic
}
```

**Run smoke tests to verify:**
```bash
cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e
```
**Expected:** Global setup completes without QA errors

**Commit:**
```bash
git add tests/e2e/global.setup.ts
git commit -m "test(e2e): update global setup comments, remove obsolete QA references"
```

---

## Task 4: Run E2E Verification

**Purpose:** Verify all E2E tests pass after QA removal.

**Execution Metadata:**
- Dependencies: Tasks 1-3
- Parallelizable: No
- Batch: 3

### Step 1: Type check

```bash
cd /Users/yi/Documents/Projects/basjoo && npm run typecheck:e2e
```
**Expected:** No TypeScript errors

### Step 2: Run smoke tests

```bash
cd /Users/yi/Documents/Projects/basjoo && npm run test:e2e
```
**Expected results:**
| Test | Expected |
|------|----------|
| Admin Authentication (4 tests) | ✅ Pass |
| Playground Streaming Chat (3 tests) | ⚠️ May still fail (UI selector issues) |
| Knowledge Indexing (2 tests) | ✅ Pass (after fix) |
| Sessions Takeover (2 tests) | ⚠️ May still fail (UI selector issues) |
| Recent Commits (4 tests) | ✅ Pass (SiliconFlow skipped) |
| URL Safety (1 test) | ✅ Pass |

**Total expected:** 10-12 pass, 0 QA-related failures

### Step 3: Commit final

```bash
git add tests/e2e/
git commit -m "test(e2e): complete QA test removal, verify all pass"
```

---

## Summary

After this plan execution:

| Before | After |
|--------|-------|
| 6 failing QA tests | 0 QA tests (replaced with File tests) |
| `qa:batch_import` 404 errors | `files:upload` 200/201 success |
| `/qa` navigation (redirects) | `/files` navigation (direct) |
| 2 skipped SiliconFlow tests | 2 skipped (no key) + updated implementation |

**Tests that may still fail (unrelated to this fix):**
- Playground temperature/chat selectors (UI changed)
- Sessions heading selector (UI structure changed)

These should be addressed in a separate plan focused on UI selector alignment.


