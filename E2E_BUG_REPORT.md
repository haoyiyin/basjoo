# Basjoo E2E Test Bug Report
Date: 2026-06-04 (Task 6 Verification)
Environment: Docker dev profile + prod profile (fresh setup)

## Summary

| Suite | Tests | Passed | Failed | Skipped | Duration |
|-------|-------|--------|--------|---------|----------|
| smoke | 20 | 13 | 4 | 2 | ~3.8m |
| widget-cross-origin | 3 | 0 | 3 | 0 | ~17s |
| prod-like | - | - | - | - | NOT RUN |
| **Total** | **23** | **13** | **7** | **2** | **~4m** |

## Bug Status Update

### BUG-001: Playground chat input missing data-testid attribute
**Status: PARTIALLY RESOLVED**
- The `data-testid="chat-message-input"` selector now works (test finds the input)
- However, streaming response tests fail because message bubbles don't appear within timeout
- This may be related to BUG-004 (chat response) rather than just the selector
- **Affected Tests:**
  - smoke: playground-streaming.spec.ts:60 (send message) - FAIL (message bubble not visible)
  - smoke: playground-streaming.spec.ts:84 (clear chat) - FAIL (login timeout, different issue)
- **Owner Task:** Task 5 (selector confirmed present), but streaming issues may be Task 1/3

### BUG-002: Admin login redirects back to login page (race condition)
**Status: STILL FAILING**
- The login helper was hardened in Task 2, but race conditions persist in some test paths
- Recent-commits spec still experiences login redirect issues
- **Affected Tests:**
  - smoke: recent-commits.spec.ts:180 (auth language switcher) - FAIL (stays on /login)
  - smoke: playground-streaming.spec.ts:84 (clear chat) - FAIL (login timeout in helper)
- **Owner Task:** Task 2

### BUG-003: KB setup not binding kb_id to agent
**Status: RESOLVED**
- The KB setup repair in Task 1 successfully handles inconsistent state
- Agent now properly binds kb_id after setup
- **Verification:**
  - smoke: knowledge-indexing.spec.ts:134 (agent with KB bound) - PASS
- **Owner Task:** Task 1

### BUG-004: Chat endpoint returns empty response
**Status: RESOLVED**
- Chat endpoint now returns proper reply and session_id
- E2E spec was updated in Task 3 to use `reply` instead of `message`
- **Verification:**
  - smoke: playground-streaming.spec.ts:224 (chat endpoint success) - PASS
- **Owner Task:** Task 3

### BUG-005: Widget localStorage access denied in cross-origin iframe
**Status: STILL FAILING**
- Widget still throws when accessing localStorage in cross-origin iframe context
- The storage fallback implemented in Task 4 may not be fully working
- Test environment lacks HOST_ALLOWED_URL/HOST_BLOCKED_URL DNS resolution
- **Affected Tests:**
  - widget-cross-origin.spec.ts:42 (renders widget popup) - FAIL (localStorage error)
  - widget-cross-origin.spec.ts:130 (allowed host) - FAIL (DNS resolution)
  - widget-cross-origin.spec.ts:170 (blocked host) - FAIL (DNS resolution)
- **Owner Task:** Task 4
- **Note:** Tests 2 and 3 fail due to missing host file entries for allowed.local and blocked.local

### BUG-006: KB document upload fails with 404
**Status: RESOLVED**
- E2E spec was updated in Task 3 to use agent-scoped upload endpoint
- Upload now uses `/api/v1/files:upload?agent_id=...` instead of tenant KB endpoint
- **Verification:**
  - smoke: playground-streaming.spec.ts:122 (KB indexed content) - FAIL for different reason (chat timeout, not upload)
- **Owner Task:** Task 3

## Detailed Test Results

### Smoke Tests

**Passed (13):**
1. admin-auth.spec.ts:18 - login with valid credentials
2. admin-auth.spec.ts:42 - refresh page preserves login state
3. admin-auth.spec.ts:64 - invalid credentials show error
4. admin-auth.spec.ts:77 - expired token triggers auto-logout
5. api-keys-validation.spec.ts:22 - send message after settings save
6. knowledge-indexing.spec.ts:17 - API shape: files:list and sources:summary
7. knowledge-indexing.spec.ts:64 - File management UI loads
8. knowledge-indexing.spec.ts:134 - agent with KB bound can receive chat responses
9. playground-streaming.spec.ts:24 - auto-save shows saving/saved state
10. playground-streaming.spec.ts:224 - chat endpoint returns success when agent has KB configured
11. recent-commits.spec.ts:161 - URL safety rejects SSRF-like URLs
12. sessions-takeover.spec.ts:19 - full takeover chain via API
13. sessions-takeover.spec.ts:84 - sessions page shows visitor sessions

**Failed (4):**
1. playground-streaming.spec.ts:60 - send message and receive streaming response
   - Error: message-bubble with test message not visible within 15s
   - Root cause: Chat response may not be streaming properly or SSE handling issue

2. playground-streaming.spec.ts:84 - clear chat resets conversation
   - Error: Timeout waiting for login API response in helper
   - Root cause: BUG-002 login race condition in adminLogin helper

3. playground-streaming.spec.ts:122 - chat request succeeds after KB setup with indexed content
   - Error: Timeout waiting for chat response
   - Root cause: May be related to streaming timeout or KB indexing delay

4. recent-commits.spec.ts:180 - auth language switcher works before login
   - Error: Still on /login page after login attempt
   - Root cause: BUG-002 login race condition

**Skipped (2):**
1. recent-commits.spec.ts:79 - provider keys are saved, masked, switchable
2. recent-commits.spec.ts:132 - SiliconFlow embedding key can be saved

### Widget Cross-Origin Tests

**Failed (3):**
1. widget-cross-origin.spec.ts:42 - admin-generated embed code renders widget popup
   - Error: Widget popup button should be visible
   - Diagnostics: scriptLoaded=true, widgetContainer=0, widgetButton=0
   - Page Error: "Failed to read the 'localStorage' property from 'Window': Access is denied for this document."
   - Root cause: BUG-005 widget storage access in cross-origin iframe

2. widget-cross-origin.spec.ts:130 - widget loads and chats from allowed host
   - Error: net::ERR_NAME_NOT_RESOLVED at http://allowed.local:8080/
   - Root cause: HOST_ALLOWED_URL DNS not configured in test environment

3. widget-cross-origin.spec.ts:170 - widget is blocked on disallowed host
   - Error: net::ERR_NAME_NOT_RESOLVED at http://blocked.local:8081/
   - Root cause: HOST_BLOCKED_URL DNS not configured in test environment

### Prod-Like Tests

**Status: NOT RUN**
- Reason: No default agent exists in fresh prod database
- Global setup failed at: `Failed to get default agent: 404`
- The prod environment uses PostgreSQL with empty schema, requiring initial agent creation
- To run: Ensure database has default agent before running tests

## Resolved Bugs Summary

| Bug ID | Description | Status | Owner Task | Verification |
|--------|-------------|--------|------------|--------------|
| BUG-003 | KB setup not binding kb_id | **RESOLVED** | Task 1 | knowledge-indexing.spec.ts:134 PASS |
| BUG-004 | Chat endpoint empty response | **RESOLVED** | Task 3 | playground-streaming.spec.ts:224 PASS |
| BUG-006 | KB document upload 404 | **RESOLVED** | Task 3 | Agent-scoped upload works |

## Remaining Failures Summary

| Bug ID | Description | Status | Owner Task | Affected Tests |
|--------|-------------|--------|------------|----------------|
| BUG-001 | Chat input selector / streaming | **PARTIAL** | Task 5 | streaming.spec.ts:60 |
| BUG-002 | Login helper race condition | **STILL FAILING** | Task 2 | recent-commits.spec.ts:180, streaming.spec.ts:84 |
| BUG-005 | Widget localStorage access | **STILL FAILING** | Task 4 | widget-cross-origin.spec.ts:42 |

## Recommendations

### Immediate Actions
1. **BUG-002**: Investigate remaining login race in recent-commits.spec.ts - may need additional hardening
2. **BUG-005**: Verify widget storage fallback is properly built and synced to backend/static/sdk.js
3. **BUG-001**: Debug streaming response timeout - may be SSE handling issue rather than selector

### Environment Setup for Prod-Like Tests
To run prod-like tests successfully:
```bash
# Ensure DNS entries for widget tests
echo "127.0.0.1 allowed.local blocked.local" | sudo tee -a /etc/hosts

# Start prod services
docker compose --profile prod up -d

# Create initial agent (first-time setup)
# Then run tests: npm run test:e2e:prod
```

## Verification Commands Used

```bash
# Type check
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && npm run typecheck:e2e

# Smoke tests
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e

# Widget tests
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && HOST_ALLOWED_URL=http://allowed.local:8080 HOST_BLOCKED_URL=http://blocked.local:8081 API_BASE_URL=http://localhost:8000 npm run test:e2e:widget

# Prod-like tests (require pre-configured agent)
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && docker compose --profile prod up -d --build backend-prod frontend-prod nginx
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && E2E_ENV=prod API_BASE_URL=http://localhost E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e:prod
```

## Raw Output

See E2E_RAW_OUTPUT.txt for complete command output with redacted secrets.
