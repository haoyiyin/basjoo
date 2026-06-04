# Basjoo E2E Test Bug Report
Date: 2026-06-04
Environment: Docker dev profile (fresh setup)

## Summary

| Suite | Tests | Passed | Failed | Skipped | Duration |
|-------|-------|--------|--------|---------|----------|
| smoke | 20 | 13 | 5 | 2 | ~3.3m |
| widget-cross-origin | 3 | 0 | 1 | 2 | ~17s |
| prod-like | 23 | 13 | 5 | 5 | ~2.4m |
| **Total** | **46** | **26** | **11** | **9** | **~6m** |

## Test Environment Details

- **Backend**: http://localhost:8000 (SQLite in dev mode)
- **Frontend**: http://localhost:3000 (Next.js dev server)
- **Nginx**: http://localhost:80 (for prod-like tests)
- **Agent ID**: agt_c829499ddd10 (created for tests)
- **E2E_API_KEY**: DeepSeek API key configured (via environment)
- **E2E_JINA_API_KEY**: Jina API key configured (via environment)

## Bug Details

### BUG-001: Playground chat input missing data-testid attribute
- **Severity**: High
- **Test**: Playground Streaming Chat - send message and receive streaming response
- **File**: tests/e2e/specs/playground-streaming.spec.ts:63
- **Error**: `expect(locator).toBeVisible() failed` - Locator: getByTestId('chat-message-input')
- **Stack Trace**:
  ```
  Error: expect(locator).toBeVisible() failed
  Locator: getByTestId('chat-message-input')
  Expected: visible
  Timeout: 10000ms
  ```
- **Root Cause Analysis**: 
  The test expects an element with `data-testid="chat-message-input"` but the actual page has a textbox with placeholder "输入您的问题..." (Enter your question) without the data-testid attribute. Looking at the accessibility tree, the chat input exists but lacks the test ID.
- **Affected Tests**:
  - smoke: playground-streaming.spec.ts:60
  - prod-like: playground-streaming.spec.ts:60, 84
- **Suggested Fix**: 
  Add `data-testid="chat-message-input"` to the chat input element in the Playground component at `frontend-nextjs/src/views/Playground.tsx` or the relevant chat input component.

### BUG-002: Admin login redirects back to login page (race condition)
- **Severity**: High
- **Test**: Playground Streaming Chat - auto-save shows saving/saved state
- **File**: tests/e2e/fixtures/e2e-context.ts:103
- **Error**: `expect(page).not.toHaveURL(expected) failed` - Expected pattern: not /\/login/ - Received: "http://localhost:3000/login"
- **Stack Trace**:
  ```
  Expected pattern: not /\/login/
  Received string: "http://localhost:3000/login"
  Timeout: 5000ms
  ```
- **Root Cause Analysis**: 
  The `adminLogin` helper in e2e-context.ts successfully submits the login form but the page redirects back to /login instead of the dashboard. This appears to be a race condition or the login API is failing. The test expects the page to navigate away from login but it stays on login.
- **Affected Tests**:
  - smoke: playground-streaming.spec.ts:24, 84
- **Suggested Fix**: 
  1. Add explicit wait for API response after login click
  2. Check if the login API is returning an error
  3. Increase timeout or add retry logic for login state verification

### BUG-003: KB setup not binding kb_id to agent
- **Severity**: Critical
- **Test**: Knowledge Source Flow - agent with KB bound can receive chat responses
- **File**: tests/e2e/specs/knowledge-indexing.spec.ts:205
- **Error**: `expect(received).toBeTruthy()` - Received: null - Agent should have kb_id bound after setup
- **Stack Trace**:
  ```
  Error: expect(received).toBeTruthy()
  Received: null
  expect(config.kb_id).toBeTruthy();
  ```
- **Root Cause Analysis**: 
  The KB setup endpoint (`/api/v1/agent:kb-setup`) returns success but does not actually bind a kb_id to the agent. The agent configuration shows `kb_id: null` after setup. This is a backend API issue where the KB setup process completes but the agent record is not updated with the kb_id.
- **Affected Tests**:
  - prod-like: knowledge-indexing.spec.ts:133
- **Suggested Fix**: 
  1. Check the `agent:kb-setup` endpoint implementation in backend
  2. Verify that the KB creation properly updates the agent's kb_id field
  3. Ensure database transaction commits the kb_id update

### BUG-004: Chat endpoint returns empty response
- **Severity**: Critical
- **Test**: Playground KB Context Retrieval - chat endpoint returns success when agent has KB configured
- **File**: tests/e2e/specs/playground-streaming.spec.ts:259
- **Error**: `expect(received).toBeTruthy()` - Received: undefined - chatData.message is undefined
- **Stack Trace**:
  ```
  Error: expect(received).toBeTruthy()
  Received: undefined
  expect(chatData.message).toBeTruthy();
  ```
- **Root Cause Analysis**: 
  The chat API returns HTTP 200 status but the response body has `message: undefined` and no `session_id`. This suggests the chat endpoint is failing silently or the LLM API call is failing without proper error handling. The API returns an empty/invalid response body.
- **Affected Tests**:
  - smoke: playground-streaming.spec.ts:224
  - prod-like: playground-streaming.spec.ts:224
- **Suggested Fix**: 
  1. Add response validation to the chat endpoint
  2. Ensure proper error messages are returned when LLM API fails
  3. Check if the DeepSeek API key is properly configured and has credits

### BUG-005: Widget localStorage access denied in cross-origin iframe
- **Severity**: Medium
- **Test**: Widget Cross-Origin - admin-generated embed code renders widget popup
- **File**: tests/e2e/specs/widget-cross-origin.spec.ts:127
- **Error**: `Widget popup button should be visible` - pageErrors: ["Failed to read the 'localStorage' property from 'Window': Access is denied for this document."]
- **Stack Trace**:
  ```
  Widget diagnostic results: {
    scriptLoaded: true,
    widgetContainer: 0,
    widgetButton: 0,
    pageErrors: ["Failed to read the 'localStorage' property from 'Window': Access is denied for this document."]
  }
  ```
- **Root Cause Analysis**: 
  The widget uses localStorage to persist visitor sessions, but when running in Playwright's cross-origin test environment with third-party iframe contexts, the browser denies localStorage access due to security policies. This is a known limitation of testing widgets in simulated cross-origin environments.
- **Affected Tests**:
  - smoke: widget-cross-origin.spec.ts:42
  - prod-like: widget-cross-origin.spec.ts:42
- **Suggested Fix**: 
  1. Add fallback to memory storage when localStorage is unavailable
  2. Wrap localStorage access in try-catch with graceful degradation
  3. Consider using a test-specific build of the widget that mocks storage

### BUG-006: KB document upload fails with 404
- **Severity**: Medium
- **Test**: Playground KB Context Retrieval - chat request succeeds after KB setup with indexed content
- **File**: tests/e2e/specs/playground-streaming.spec.ts:182
- **Error**: `Expected value: 404` - Upload should succeed (may be 200 or 202) - Received: [200, 202, 201]
- **Root Cause Analysis**: 
  The test expects the upload endpoint to return 200/202 but the assertion is inverted. Looking at the error message more carefully, it seems the endpoint might actually be returning 404 when the tenant KB document endpoint is not available or the kb_id is not properly set.
- **Affected Tests**:
  - smoke: playground-streaming.spec.ts:122
- **Suggested Fix**: 
  Verify the tenant KB document upload endpoint is properly implemented and accessible at `/api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents`

## Skipped Tests Summary

The following tests were skipped (likely due to preconditions not met):

1. **recent-commits.spec.ts:79** - "provider keys are saved, masked, switchable, and usable for embedding API tests"
2. **recent-commits.spec.ts:132** - "SiliconFlow embedding key can be saved and validated without legacy QA index"
3. **widget-cross-origin.spec.ts:130** - "widget loads and chats from allowed host" (depends on first test)
4. **widget-cross-origin.spec.ts:170** - "widget is blocked on disallowed host" (depends on first test)
5. **playground-streaming.spec.ts:122** - "chat request succeeds after KB setup with indexed content" (KB setup issues)

## Recommendations

### Immediate Actions (Critical)
1. **Fix BUG-003**: Investigate why KB setup doesn't bind kb_id to agent
2. **Fix BUG-004**: Debug chat endpoint empty response issue

### Short-term Actions (High Priority)
3. **Fix BUG-001**: Add missing data-testid attributes to Playground chat components
4. **Fix BUG-002**: Add proper wait/retry logic for login flow

### Medium Priority
5. **Fix BUG-005**: Add localStorage fallback for widget cross-origin scenarios
6. **Fix BUG-006**: Verify KB document upload endpoint

## Verification Commands

To re-run specific failing tests:

```bash
# Smoke tests only
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke

# Specific failing test
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke --grep "send message and receive streaming response"

# With UI mode for debugging
cd /Users/yi/Documents/Projects/basjoo && E2E_API_KEY=$DEEPSEEK_API_KEY npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke --ui
```

## Test Results Location

- Playwright HTML Report: `tests/playwright-report/index.html`
- Test failure screenshots: `test-results/`
- Error context files: `test-results/*/error-context.md`
