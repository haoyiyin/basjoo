# AGENTS.md

## Scope
This is the primary reference for AI coding agents (Pi, Claude, Cursor, Aider, etc.) working on the Basjoo repository. **Always read this file, CLAUDE.md, and relevant sections of README.md before starting any task.**

## Project overview
Docker-oriented AI customer support platform:
- FastAPI backend with multi-tenant KB (Qdrant-backed RAG), streaming chat (SSE), knowledge ingestion, admin auth, quotas.
- Vite SPA admin dashboard in `frontend-nextjs/` (React 18 + react-router 7; the directory name is a leftover from the former Next.js app).
- Embeddable TypeScript widget in `widget/` (localStorage sessions, SSE, human takeover).
- Supporting: Scrapling microservice, Qdrant (vector DB), Redis, nginx.
- Persistence is **SQLite only** (`aiosqlite`). There is no PostgreSQL anywhere in the stack.
- All LLM calls go to external providers; embeddings go through a per-KB provider (Jina / SiliconFlow / OpenAI-compatible custom).

## Repository layout
- `backend/` — FastAPI app, `services/` (logic), `api/` (thin routers), `models.py`, `tests/`.
- `frontend-nextjs/` — Vite SPA: `src/App.tsx` (routes), `src/views/`, `src/components/`, `src/hooks/`, `src/services/api.ts`.
- `widget/` — `src/BasjooWidget.tsx`, esbuild bundles, `example/`.
- `scrapling-service/` — standalone stealth scraper (curl_cffi + readability).
- `nginx/` — reverse proxy used only by the `prod` profile.
- `docker-compose.yml` — dev/prod profiles.
- `tests/e2e/` — Playwright specs (root-level, not inside the frontend).

## Required tools and setup
- Dev stack: `docker compose --profile dev up --watch`.
- Backend local: `cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python3 main.py`.
- Frontend: `cd frontend-nextjs && npm install`.
- Widget: `cd widget && npm install`.
- Environment: documented in `.env.example`; `SECRET_KEY`, `ENCRYPTION_KEY`, `DEFAULT_AGENT_ID` auto-persisted to `/app/data/` (preserve the volume in prod). Never commit secrets.

## Development commands
- Frontend dev: `cd frontend-nextjs && npm run dev` (Vite on :3000, proxies `/api`, `/sdk.js`, `/widget-demo`, `/basjoo-logo.png`, `/health` to `BACKEND_PROXY_TARGET`).
- Frontend verify: `cd frontend-nextjs && npm run build && npm run typecheck && npm run test`.
  - `npm run build` already runs `tsc --noEmit`. There is **no** `npm run lint` and **no** `npm run start` in this package.
- Widget dev: `cd widget && npm run dev`.
- Widget build (typecheck + ESM + IIFE bundles): `cd widget && npm run build`.
- Sync widget bundle into the backend: `npm run sync-widget` (root; copies `widget/dist/basjoo-widget.min.js` → `backend/static/sdk.js`).
- Backend tests: `cd backend && pytest` (uses `pytest.ini`; `Test*` classes, `test_*` funcs).
- E2E (smoke, dev env): `npm run test:e2e` (auto-starts `docker compose --profile dev`).
- E2E (prod-like): `npm run test:e2e:prod` (requires `docker compose --profile prod up -d` first).
- E2E (all): `npm run test:e2e:all`. E2E (widget cross-origin): `npm run test:e2e:widget`.
- Docker rebuild: `docker compose --profile dev up -d --build <service>`.
- Health: `curl http://localhost:8000/health`.

## Must-follow conventions
- **Structure**: Backend logic strictly in `backend/services/`; thin routers in `backend/api/`. Models in `backend/models.py`. Frontend views in `src/views/`, shared components in `src/components/`, hooks in `src/hooks/`. Widget self-contained in `widget/src/`.
- **Style**: Python — 4 spaces, snake_case for modules/functions/tests. TypeScript/React — 2 spaces, PascalCase for components/views, `use*` hooks. Explicit TS types; no `any`.
- **Commits**: Conventional (`feat:`, `fix:`, `docs:`), scoped, imperative. PRs require summary, test commands+output, UI screenshots, migration notes.
- **Security**: Route all URLs through `backend/services/url_safety.py` (SSRF + DNS cache). Widget origin whitelists enforced. Handle CORS/rate-limit via shared middleware helpers.

## Architecture boundaries
- `backend/main.py` owns the app factory, middleware (CORS, i18n, rate-limit, body-size), router mounting (`/api/admin`, `/api/v1`, `/api/tenants`), static asset routes (`/sdk.js`, `/basjoo-logo.png`, `/widget-demo`), and scheduler/Redis lifespan.
- KB stack (`kb_service.py`, `kb_document_processor.py`, `kb_retrieval_service.py`, `qdrant_service.py`):
  - One tenant per agent's KB (`Tenant` → `KnowledgeBase` → `KbDocument` → `KbChunk`).
  - One Qdrant collection per KB (`kb_<12 hex chars>`, Cosine distance), plus a `tenant_id` payload filter — physical + logical isolation.
  - Chunking defaults: `chunk_size=512`, `chunk_overlap=64`; embeddings upserted in batches of ≤100.
  - Retrieval: query embed → Qdrant top `top_k * 2` → post-filter by score → cap at `top_k`. Effective threshold = explicit arg > `agent.similarity_threshold` > service default `0.6`. Agent default is `0.01` (`DEFAULT_AGENT_SIMILARITY_THRESHOLD`); the settings slider maps `0–100` → `0.00–0.100` (×1000).
- Task concurrency is guarded by a shared `TaskLock` (`services/task_lock.py`, `TaskType` enum) in URL/index/KB-reset endpoints.
- Widget auto-detects `apiBase` from `<script src>`; persists visitor/session in localStorage; polls `/api/v1/chat/messages` every 3s for human-takeover messages.

## Chat request flow (`POST /api/v1/chat/stream`)
Two phases on purpose — never hold a DB connection while the LLM streams:
1. Short-lived DB session: resolve agent → widget origin whitelist → daily quota → get/create `ChatSession` → if `taken_over`, persist the message and finish → per-session per-minute rate limit (returns `restricted_reply`) → load history → KB retrieval → build messages. Session closes here.
2. No DB connection: emit `sources`, stream `content` deltas (plus `thinking_done` when the provider supports it), then `done` with `message_id`/`session_id`/`usage`/`taken_over`. LLM failure falls back to `agent.restricted_reply`. Hard cap 300s.

SSE event names are `sources`, `content`, `thinking_done`, `done`, `error`. Anything else is a bug — the widget parser ignores unknown events.

## When changing areas
- **New LLM provider**: extend `backend/services/llm_service.py` (`provider_type` branch), update the `Agent` model/config, expose it in `src/components/AISettingsForm.tsx`.
- **New knowledge source type**: extend the shared ingestion path (`services/kb_document_processor.py` + `services/document_parser.py`) and surface it through the **agent-scoped** endpoints in `backend/api/v1/endpoints.py`. Do not extend `kb_document_endpoints.py` — see "Known dead code".
- **UI change**: update `src/views/` or `src/components/`; add i18n strings in `src/locales/{zh-CN,en-US}/`; verify responsiveness.
- **Post-agent-creation KB onboarding**: in `src/views/Agents.tsx`, after `api.createAgent` succeeds set `onboardingAgentId`. That triggers `KBSetupWizard` (via `useAgentKbStatus` + `kbStatus` API + `kb_setup_completed`). On complete/skip call `recheck()`, then `navigate("/agents/{id}/dashboard")`.
- **Chat streaming issues**: inspect SSE in `backend/api/v1/endpoints.py`, `sse_utils.py`, the widget parser, and the error middleware.
- **Indexing/retrieval problems**: check `kb_retrieval_service.py`, `qdrant_service.py`, threshold, `is_indexed` on `URLSource`, and `sources:summary` / `index:status`.
- **Large exploration/analysis**: use `rg`/`search_files` and read targeted ranges rather than dumping whole files (`endpoints.py` is ~3.9k lines).

## Testing and verification (mandatory before claiming done)
- Frontend changes: always `cd frontend-nextjs && npm run build && npm run typecheck && npm run test` (Vitest, `maxWorkers: 1` — several tests mock globals, keep it serial).
- Backend changes: `cd backend && pytest` for the affected tests (fixtures in `conftest.py`: `client`, `public_client`).
- Docker changes: `docker compose --profile dev up --build`.
- E2E or widget: the relevant `npm run test:e2e:*`.
- Major changes: request code review.
- For bugs: reproduce first, then fix (systematic debugging). For features: plan before writing code.

## Subsystem-specific
### Backend RAG / ingestion
- URL pipeline: `create_urls` → `URLSource` row (pending) → background fetch through Scrapling → content stored → chunk/embed into the agent's KB → `is_indexed`.
- Force rebuild vs incremental is controlled by the `force` param on `/index:rebuild`.
- File pipeline: `/files:upload` writes bytes + a `KbDocument` (status `pending`) → `BackgroundTasks` → `DocumentParser` (pdfplumber / python-docx / openpyxl) → chunk → embedding → Qdrant upsert → status `ready`/`error`.
- Limits: ≤5 files per request, 20 MB per file, extensions `txt md html pdf docx xlsx`.
- `/files:list` reads `KbDocument` (excluding `url_*` rows); `/urls:list` reads `URLSource`.

**Agent-scoped KB endpoints are the live path.** The tenant-scoped REST surface (`POST/GET/DELETE /api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents`, `/config`, `/reset`, and `POST /api/tenants/{tid}/agents/{aid}/retrieve`) exists in code but has no caller in the frontend, widget, or e2e suite. Treat it as unshipped.

### Frontend
- Centralized API/SSE client plus the `kbStatus` helper in `src/services/api.ts`.
- Auth state in `src/context/AuthContext.tsx` (localStorage).
- `useAgentKbStatus` hook drives the first-time KB flow.
- Nav and route scoping are role-driven in `src/components/AdminLayout.tsx`: `super_admin` sees only dashboard + agents at the root level and the full set inside an agent; `support` sees only the agent's sessions page.
- `ThemeProvider` (in `AppProviders`) applies `data-theme` on `<html>`, which `src/index.css` keys off. Keep it even though `useTheme` itself has no live consumer.

### Widget
- Build produces `dist/basjoo-widget.js` (ESM) and `.min.js` (IIFE); always run `npm run sync-widget` after changes affecting embeds, then commit the regenerated `backend/static/sdk.js`.
- Maintains backward compatibility for existing script embeds (agent ID persistence, `?agent_id=` and `?agentId=` query params).

## Known dead code (do not extend, do not "fix" by wiring up)
Left over from the Next.js → Vite migration and from the abandoned tenant-KB REST surface. Removing these is a separate cleanup task; touching them inside an unrelated change is noise.

**Frontend**
- `src/views/AgentSettings 2.tsx` (1,630 lines) — accidental Finder duplicate, not routed and not imported anywhere. It is the only consumer of `api.clearAgentError`, `useTheme`, and ~100 i18n keys, so deleting it strands those keys too.
- `src/utils/textSanitizer.ts` — zero imports.
- `src/views/Chat.tsx` + route `/chat/:sessionId` — no link or `navigate()` targets it; `Sessions.tsx` handles messages inline. Orphan route.
- `src/views/Setup.tsx` + route `/setup` — legacy AI-config wizard with no inbound link (`Login.tsx` points at `/register`). Orphan route.
- `"use client"` at the top of 14 files — Next.js directive, a no-op under Vite.
- Unused methods in `src/services/api.ts`: `checkHealth`, `getIndexInfo`, `listModels`, `discoverURLs`, `getAdminSessions`, `getAdminSessionMessages`, `getJinaKeyStatus`, `updateJinaApiKey`, `clearAgentError`.
  - `clearAgentError` posts to `/api/v1/agent:clear-error`, an endpoint that **does not exist** in the backend. Do not call it.
- ~300 of 680 keys per locale file are unreferenced (`labels.*` bulk, the removed Q&A import feature, playground index-rebuild strings, `theme.*`).

**Backend**
- `backend/api/v1/kb_document_endpoints.py` (333 lines, 10 routes, prefix `/api/tenants`) — no frontend, widget, e2e, or backend test calls it. `kb_service` / `kb_document_processor` / `kb_retrieval_service` are live; this router is not.
- `backend/services/file_service.py` — imported as `svc_list_files` / `svc_upload_files` / `svc_delete_file` / `svc_clear_all_files` in `endpoints.py` but never called. It is the only writer of `KnowledgeFile`, which is why `Agent.file_count` in `build_agent_config_with_stats` is permanently `0` while `/files:list` returns real `KbDocument` rows (agent cards show 0 files).
- `URLNormalizer` and `check_content_changed` (`services/scraper.py`, re-exported by `services/__init__.py`) — imported, never called. URL normalization actually happens via `models.normalize_url`.
- `POST /api/v1/urls:repair-indexed-status` — one-off data repair from a historical bug, no caller.
- `POST /api/v1/contexts`, `GET /api/v1/models:list`, `GET /api/v1/agent:jina-key-status`, `PUT /api/v1/agent:jina-key` — no product caller (one e2e spec uses `/contexts`).
- `backend/migrations/*.py` (11 scripts, ~930 lines) — nothing invokes them; `backend/sqlite_migrations.py` is the real migration path (auto-runs on startup).
- `bootstrap-env.sh` + `backend/env_bootstrap.py` — copied into the image but never imported by `docker-entrypoint.py`; nothing calls the shell wrapper.
- `IndexJob` model — never instantiated. `/index:rebuild` returns a `job_id` that is never persisted.
- `Tenant.slug` / `Tenant.plan`, `ChatSession.visitor_region` — written, never read.

**Repository hygiene**
- Tracked artifacts: `E2E_TEST_REPORT.md`, `E2E_BUG_REPORT.md`, `E2E_RAW_OUTPUT.txt`, `tests/playwright-report/index.html` (559 KB), `package-lock 2.json`, `widget/example/basjoo-widget.js` (stale build output).
- `frontend-nextjs/.next/` (67 MB) exists on disk from the Next.js era; gitignored, safe to delete.

## Safety and operational notes
- Persistent volumes (`backend-data` → `/app/data`, `redis-data`, `qdrant-data`) are critical; `install-deploy.sh` preserves them. There is no `postgres-data` volume.
- `Origin: null` CORS only when `cors_allow_null_origin=true`; a missing Origin never gets a wildcard.
- Ask before destructive ops (full DB reset, prod deploy, archive changes without `--yes`).
- Qdrant collection handles and task locks are process-scoped or Redis-backed; do not assume cross-restart persistence for caches.
- Background schedulers (started in `main.py` lifespan, skipped in test mode): URL auto-fetch hourly, history cleanup daily at 03:00, session auto-close every 5 min after 30 min idle, soft-deleted agent purge every 24 h (`purge_after = deleted_at + 7 days`).
- Local QA note: `docker-compose.qa-override.yml` (untracked) puts app services on the host network because this dev host runs dockerd with `--iptables=false`. Do not use it in production.

## Pull request checklist
- Run targeted verification commands and include output.
- Update docs, i18n, schemas, or fixtures when behavior changes.
- Call out risks, migrations, or follow-ups.
- Decide merge/PR/cleanup after implementation.
- If conventions or architecture evolve, update this file, CLAUDE.md, and README.

**This is living documentation. Update when patterns change.**

Last updated: 2026-10-25 (verified against HEAD `f56286f`: Vite SPA replaces Next.js, SQLite-only persistence, real scheduler intervals, chat SSE flow, and a known-dead-code inventory)
