# Changelog

All notable changes to this project should be documented in this file.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Human handoff (#43): one answer gate (`services/session_state.answer_gate`) decides whether the bot speaks, so `/chat` and `/chat/stream` cannot drift. Operator `reply` mutes the bot without a takeover, `release` hands it back, and `resolve` is distinct from the timeout `closed`. The reason travels as `done.no_answer_reason` (`taken_over`, `resolved`, `closed`, `paused`, `human`, `after_hours`).
- Business hours (#43): `business_hours` (IANA timezone + weekday/minute ranges, `zoneinfo`, wrap-past-midnight and DST) now actually gates the answer instead of only round-tripping through the console. A closed schedule stores the visitor message, answers nothing, reports `after_hours` with `mode` unchanged, and ships the operator's `away_message` as the visible reply without writing it to the transcript. No config, an empty schedule, or an unparsable one stays always-online.
- One-command production installer/deployer (`install-deploy.sh`): auto-installs Docker/Compose, clones/syncs repository, deploys production profile via `deploy.sh`, and verifies container health checks.
- `deploy.sh` now supports `BASJOO_DOCKER_BIN` environment variable for custom Docker binary invocation (e.g., `sudo docker`).
- SSRF protection for URL ingestion (`backend/services/url_safety.py`): blocks localhost, direct IP literals, embedded credentials, and hostnames resolving to private/special-use IPs.
- Admin authentication at the router level for URL/Q&A management (`url_endpoints.py`) and index rebuild (`index_endpoints.py`) endpoints.
- `cors_allow_null_origin` config flag (default `false`) for explicit `file://` widget preview support in dev environments.
- `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` for Fernet-based API key encryption at rest (`core/encryption.py`).
- `REQUIRE_SECRET_KEY` environment variable to reject insecure secret keys in production.
- Key rotation support for Jina embedding client.
- E2E test workflow with Playwright: smoke, prod-like, and widget cross-origin test projects.

### Changed

- `scrapling-service` now renders pages with an in-process crawl4ai headless Chromium (`crawl4ai==0.9.5`) and feeds crawl4ai's markdown to the knowledge base instead of readability output. JS-only sites that used to return only their meta description (113-196 chars reported as `success=True`) now either produce real content or fail loudly, so an empty document no longer lands in the KB. The `curl_cffi` + `httpx` + `readability-lxml` path stays as the fallback when the browser cannot start, and the `POST /fetch` / `POST /discover` HTTP contract is unchanged. The container needs `shm_size: 512mb` and a 60 s healthcheck start period (≈700 MB idle, ≈1.2 GB at 4 concurrent pages); no memory limit is set, because a 1.5 GB cap made crawls fail silently.
- SSRF protection for URL ingestion is now opt-in (`SSRF_PROTECTION_ENABLED`, default off): the resolved-IP rule broke every fetch on hosts whose resolver returns fake-ip/ULA addresses for public sites. Scheme, credential, empty-host, `localhost` and direct-IP-literal validation still always run; only the DNS-range lookup is gated. `scrapling-service` honours the same flag.
- CORS policy tightened: missing `Origin` headers no longer receive wildcard CORS; `Origin: null` only allowed when `cors_allow_null_origin` is explicitly enabled.
- Early-response CORS handling unified through a single shared helper (`apply_cors_headers` in `backend/middleware/rate_limit.py`).
- URL validation in schemas replaced with the shared SSRF safety check, removing localhost and direct IP acceptance.
- Scheduler shutdown lifecycle made symmetric; secret handling and login fallback limiter tightened.
- Health endpoint behavior unified across request paths.
- Chat rate limits operate on per-minute sliding windows.
- URL normalization improved for repeated query parameters.
- URL fetch/crawl quota paths and training-state synchronization tightened.

### Fixed

- In-memory sliding window rate limiter now evicts stale keys to prevent unbounded map growth.
- Widget XSS gap in source rendering and frontend polling/reconnect stability improved.
- Widget embed security model replaced Turnstile dependency with per-agent origin whitelist enforcement.

### Documentation

- Updated README.md / README.zh-CN.md with current commands, env vars, architecture, and security model.
- Rewrote tests/README.md around actual test execution entry points, correcting stale directory claims.
- Patched openspec/project.md with missing services and security requirements.
- Added one-command production install documentation to README.md, README.zh-CN.md, and CLAUDE.md.
- Clarified README.md / README.zh-CN.md deployment onboarding by separating automatic deployment from manual deployment.

---

If you want to preserve release-by-release history going forward, append dated/versioned sections here whenever you cut a release.