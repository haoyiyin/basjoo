# Changelog

All notable changes to this project should be documented in this file.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Scripted keyword fallback (#60): `agent.fallback_mode` (`off` default, `keyword`) adds an LLM-free answer source, matching the visitor message against `qa_items.keywords` — a JSON list normalised at write time, `<2` characters rejected with `400 keyword_too_short`, capped at 20 keywords × 40 characters. `backend/services/keyword_fallback.py` is pure stdlib (NFKC → lowercase → non-word → space, whole-token or ≥2-character substring, 1.0 per match, ties by `hits` then `id`), so it touches no provider, no embedding and no Qdrant; at the key gate it short-circuits inside `prepare_chat_request`, and the five provider-failure sites consult it ahead of the restricted reply. A hit — and a miss, which is a normal 200 with `restricted_reply`, never a 429 — is a normal assistant turn marked `mode="scripted"` + `matched_by="keyword"` on the `ChatResponse` and the SSE `done` event, persisted as `mode="scripted"` on the assistant row, and noted in the widget and the session transcript. A scripted answer costs 0 tokens but still counts as one answered turn, and `hits`/`last_hit_at` are recorded for the pair served. Operators get a keyword editor and a `POST /api/v1/knowledge-bases/{kb_id}/qa-items:match` tester in the Q&A panel. `off` keeps today's behaviour byte for byte, and the keyless-agent 400 (`API_KEY_MISSING`) survives unless the operator opts in (or an authenticated preview turn is served). Superseded in part by #62/#64: the `llm` and `llm_then_keyword` values went with the fallback model, and the quota gate that used to serve this path is gone — the key gate serves it now.
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
- Agent settings page (#63): the form is grouped into ordered sections — define AI → materials → handoff → install → outbound — instead of one long scroll of unrelated fields.
- Row-level controls (#65): list/table row actions across views converted to icon buttons (`btn-icon` with `aria-label` + `title`) on the 43-glyph `ICON_NAMES` registry (was 19), one text button per view remaining the primary action.
- Keyless keyword path (#66): a keyless agent with `fallback_mode="keyword"` — and an authenticated Playground preview turn — is served by the scripted `qa_items` matcher instead of raising `API_KEY_MISSING`, so the Playground works without a model; a miss still falls back to the restricted reply.

### Removed

- Fallback model configuration and the degraded marker (#62): the `fallback_model` / `fallback_api_key` settings, `resolve_llm_degradation`, and the degraded SSE/marker surfaces are gone — `agent.fallback_mode` now has exactly two values, `off` (default) and `keyword`, with the old `llm` / `llm_then_keyword` values retired.
- Escalation rules and the daily message quota (#64): `escalation_rules`, `services/quota.py`, the `max_messages_per_day` / `used_messages_today` accounting, and the message-count 429 `QUOTA_EXCEEDED` path are removed.

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