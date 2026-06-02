# E2E Test Migration: QA → Files Implementation Plan

**Status:** Draft  
**Date:** 2026-06-03  
**Source:** User request to fix failing E2E tests after QA system removal  
**Goal:** Remove QA-based E2E tests and replace with Files-based tests to restore test coverage  
**Architecture:** Update E2E tests to use existing Files/URL endpoints instead of removed QA endpoints  
**Tech Stack:** TypeScript, Playwright, FastAPI

---

## Planning Notes

### Key Findings from Exploration

1. **QA API Completely Removed**
   - `POST /api/v1/qa:batch_import` → 404 Not Found
   - `GET /api/v1/qa:list` → 404 Not Found
   - No QA routes exist in `backend/api/v1/endpoints.py`

2. **Replacement APIs Available**
   - **Files API**: `POST /api/v1/files:upload`, `GET /api/v1/files:list`
   - **URL API**: `POST /api/v1/urls:create`, `GET /api/v1/urls:list`
   - **Index API**: `POST /api/v1/index:rebuild` (works for both files and URLs)

3. **Frontend Already Migrated**
   - `/qa` page redirects to `/files`
   - Files UI uses stable selectors with `data-testid` attributes

4. **Tests to Update**
   - `tests/e2e/specs/knowledge-indexing.spec.ts` - 2 QA tests need replacement
   - `tests/e2e/specs/recent-commits.spec.ts` - 2 QA tests need replacement
   - `tests/e2e/global.setup.ts` - Remove QA seeding logic

---

## Exploration Summary

| Aspect | Finding |
|--------|---------|
| QA endpoints | Removed, return 404 |
| Files endpoints | Available and functional |
| URL endpoints | Available and functional |
| Index rebuild | Works for files/URLs, same as QA |
| Frontend Files page | `/files` route exists with upload UI |
| File selectors | `data-testid="file-uploader"`, `data-testid="file-list"` |

---

## File Map

### Files to Modify

| File | Change |
|------|--------|
| `tests/e2e/specs/knowledge-indexing.spec.ts` | Replace 2 QA tests with Files tests |
| `tests/e2e/specs/recent-commits.spec.ts` | Replace 2 QA tests with Files tests |
| `tests/e2e/global.setup.ts` | Remove QA seeding, keep agent setup |

### Reference Files (Read-Only)

| File | Purpose |
|------|---------|
| `tests/e2e/specs/sessions-takeover.spec.ts` | Pattern for API-based tests |
| `tests/e2e/specs/admin-auth.spec.ts` | Pattern for UI-based tests |
| `backend/api/v1/endpoints.py` | Verify Files API structure |

---

## Parallelization Strategy

**Preferred execution model:** Single-agent sequential

This is a focused 3-file change with clear dependencies. Simple sequential execution is safest.

| Task | File | Dependencies |
|------|------|--------------|
| Task 1 | knowledge-indexing.spec.ts | None |
| Task 2 | recent-commits.spec.ts | Task 1 (learn patterns) |
| Task 3 | global.setup.ts | Task 1-2 (understand needs) |

---

## Verification Commands

```bash
# Run the specific updated tests
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/knowledge-indexing.spec.ts
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke tests/e2e/specs/recent-commits.spec.ts

# Run all smoke tests to ensure no regressions
npm run test:e2e

# Typecheck
npm run typecheck:e2e
```

**Expected Results:**
- All modified tests pass
- No new TypeScript errors
- Overall smoke test suite passes (8+ tests)

---

## Task 1: Replace QA Tests in knowledge-indexing.spec.ts

**Purpose:** Remove QA import/index tests and replace with Files upload/index/retrieval tests.

**Execution Metadata:**
- Dependencies: None
- Parallelizable: No
- Batch: 1
- Owns:
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
- Reads:
  - `tests/e2e/specs/sessions-takeover.spec.ts` (API pattern)

**Files:**
- Modify: `tests/e2e/specs/knowledge-indexing.spec.ts`

**Context for Implementer:**

Old QA Test (REMOVE):
```typescript
// POST /api/v1/qa:batch_import - returns 404, REMOVE
test('QA import and index rebuild', async ({ page, request }) => {
  // Uses POST /api/v1/qa:batch_import
});

// GET /api/v1/qa:list - returns 404, REMOVE  
test('QA management UI shows imported items', async ({ page, request }) => {
  // Uses GET /api/v1/qa:list
});
```

New Files Test (ADD):
```typescript
// Test: File upload → index → retrieval
test('File upload and index rebuild', async ({ page, request }) => {
  // 1. Login via API
  // 2. Get default agent
  // 3. Create test file content (text/plain)
  // 4. POST /api/v1/files:upload with FormData
  // 5. POST /api/v1/index:rebuild?agent_id={id}
  // 6. Poll /api/v1/index:status until completed
  // 7. POST /api/v1/contexts with query to verify retrieval
});

// Test: Files UI shows uploaded files
test('Files management UI shows uploaded items', async ({ page, request }) => {
  // 1. Upload file via API
  // 2. Login via UI
  // 3. Navigate to /files
  // 4. Verify file appears in list
  // 5. Verify upload status is ready
});
```

**API Details:**
- `POST /api/v1/files:upload` - multipart/form-data with `file` field
- Response: `{ id, filename, content_type, size, status, created_at }`
- `POST /api/v1/index:rebuild?agent_id={id}` - triggers index rebuild
- `GET /api/v1/index:status?agent_id={id}` - poll for completion
- `POST /api/v1/contexts` - verify retrieval with `{ agent_id, query, top_k }`

**TDD Steps:**

- [ ] **Step 1: Delete old QA tests**
  Remove the 2 QA test blocks from knowledge-indexing.spec.ts

- [ ] **Step 2: Write new Files API test**
  Add `test('File upload and index rebuild', ...)` skeleton with:
  - Login via API
  - Upload test file via API
  - Trigger index rebuild
  - Verify completion
  - Test context retrieval

- [ ] **Step 3: Run test and verify RED**
  ```bash
  npx playwright test tests/e2e/specs/knowledge-indexing.spec.ts --project=smoke
  ```
  Expected: Test runs, may have implementation issues

- [ ] **Step 4: Fix implementation**
  Ensure FormData construction is correct:
  ```typescript
  const formData = new FormData();
  const blob = new Blob(['Test content for E2E'], { type: 'text/plain' });
  formData.append('file', blob, 'test-e2e.txt');
  // POST with formData body
  ```

- [ ] **Step 5: Run test and verify GREEN**
  Expected: Test passes

- [ ] **Step 6: Write Files UI test**
  Add `test('Files management UI shows uploaded items', ...)`
  - Navigate to /files
  - Verify list renders

- [ ] **Step 7: Run broader verification**
  ```bash
  npm run typecheck:e2e
  npm run test:e2e
  ```
  Expected: Pass with no new warnings

- [ ] **Step 8: Commit**
  ```bash
  git add tests/e2e/specs/knowledge-indexing.spec.ts
  git commit -m "test(e2e): replace QA tests with Files tests in knowledge-indexing"
  ```

---

## Task 2: Replace QA Tests in recent-commits.spec.ts

**Purpose:** Remove QA-based regression tests and replace with Files/URL-based equivalents.

**Execution Metadata:**
- Dependencies: Task 1 (understand Files pattern)
- Parallelizable: No
- Batch: 1
- Owns:
  - `tests/e2e/specs/recent-commits.spec.ts`
- Reads:
  - Task 1 implementation

**Files:**
- Modify: `tests/e2e/specs/recent-commits.spec.ts`

**Context for Implementer:**

Old QA Test (REMOVE):
```typescript
// Lines ~157-191: SiliconFlow embedding test using QA import
test('SiliconFlow embedding can rebuild QA index and retrieve context', async ({ request }) => {
  // Uses qa:batch_import
});
```

New Files Test (ADD):
```typescript
// Replace with Files-based test
test('SiliconFlow embedding can rebuild index and retrieve context', async ({ request }) => {
  // Same pattern but use:
  // 1. POST /api/v1/files:upload to upload test document
  // 2. Index rebuild
  // 3. Context retrieval verification
});
```

Also check for any other qa:batch_import references and replace with files:upload.

**TDD Steps:**

- [ ] **Step 1: Find and remove QA references**
  Search for `qa:batch_import`, `qa:list` in recent-