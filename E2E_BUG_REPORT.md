# Basjoo E2E Test Bug Report
Date: 2026-06-04 (Final Verification)
Environment: integration worktree Docker dev + widget host containers + prod profile

## Summary

| Suite | Result | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|---:|
| smoke | PASS | 18 | 0 | 2 | 3.2m |
| widget-cross-origin | PASS | 3 | 0 | 0 | 15.1s |
| prod-like | PASS | 19 | 0 | 4 | 2.4m |

## Bug Status Update

| Bug ID | Description | Final status | Verification |
|---|---|---|---|
| BUG-001 | Playground chat input selector / streaming flow | RESOLVED | `playground-streaming.spec.ts` passed in smoke and prod-like |
| BUG-002 | Admin login helper race | RESOLVED | smoke admin/login-dependent specs passed; helper now seeds auth state for non-auth specs while `admin-auth.spec.ts` keeps UI coverage |
| BUG-003 | KB setup not binding `kb_id` | RESOLVED | `knowledge-indexing.spec.ts:134` passed; backend repair tests added |
| BUG-004 | Chat endpoint response contract / retrieval | RESOLVED | API chat tests assert `reply` + `session_id`; retrieval tenant derivation fixed |
| BUG-005 | Widget localStorage access denied | RESOLVED | widget cross-origin suite passed; `/sdk.js` includes safe storage fallback |
| BUG-006 | KB document upload route misuse | RESOLVED | E2E uses `/api/v1/files:upload?agent_id=...`; upload flow passed |

## Additional Stabilization Done

- `tests/e2e/global.setup.ts` now creates an E2E default agent if an existing test DB has an admin/workspace but no active agent.
- Playground E2E waits for visible agent ID before sending messages, avoiding route/agent-load races.
- KB upload E2E waits for terminal file processing state to avoid SQLite background-write overlap.
- Sessions E2E uses a wider admin session list limit because the endpoint sorts oldest first.
- Widget verification used `http://localhost:8080` and `http://localhost:8081` host pages to avoid host DNS dependency while still testing distinct origins.

## Verification Commands Used

```bash
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && npm run typecheck:e2e
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && HOST_ALLOWED_URL=http://localhost:8080 HOST_BLOCKED_URL=http://localhost:8081 API_BASE_URL=http://localhost:8000 npm run test:e2e:widget
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && docker compose --profile prod up -d --build backend-prod frontend-prod nginx
cd /Users/yi/Documents/Projects/basjoo-e2e-bugfix-integration && E2E_ENV=prod API_BASE_URL=http://localhost E2E_API_KEY=$DEEPSEEK_API_KEY E2E_JINA_API_KEY=$JINA_API_KEY npm run test:e2e:prod
```

## Notes

- Smoke skipped 2 provider-key regression tests because optional provider test keys were not fully present for those cases.
- Prod-like skipped 4 environment-gated tests.
- No failed tests remain in the final smoke, widget, or prod-like verification runs.

See `E2E_RAW_OUTPUT.txt` for redacted command summaries.
