# Changelog

All notable changes to this project should be documented in this file.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- SSRF protection for URL ingestion (`backend/services/url_safety.py`): blocks localhost, direct IP literals, embedded credentials, and hostnames resolving to private/special-use IPs.
- Admin authentication at the router level for URL/Q&A management (`url_endpoints.py`) and index rebuild (`index_endpoints.py`) endpoints.
- `cors_allow_null_origin` config flag (default `false`) for explicit `file://` widget preview support in dev environments.
- `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` for Fernet-based API key encryption at rest (`core/encryption.py`).
- `REQUIRE_SECRET_KEY` environment variable to reject insecure secret keys in production.
- Key rotation support for Jina embedding client.
- E2E test workflow with Playwright: smoke, prod-like, and widget cross-origin test projects.

### Changed

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

---

If you want to preserve release-by-release history going forward, append dated/versioned sections here whenever you cut a release.