# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

- `frontend-nextjs/` is the active admin/dashboard frontend. Treat the older `frontend/` directory as legacy/reference only.
- `backend/` is a FastAPI app with SQLite persistence, Redis-backed rate limiting/cache fallbacks, and Qdrant-backed retrieval/indexing.
- `widget/` builds the embeddable chat widget SDK that talks to the backend streaming chat endpoints.
- `nginx/` contains the reverse-proxy config used in Docker deployments.
- `docker-compose.yml` is the primary local/dev/prod orchestration entrypoint.

## Common commands

### Docker compose

- Start development stack: `docker compose --profile dev up -d`
- Start production-style stack: `docker compose --profile prod up -d`
- Rebuild a service: `docker compose --profile dev up -d --build backend-dev frontend-dev`
- Follow logs: `docker compose logs -f backend-dev frontend-dev nginx`
- Watch mode (auto-rebuild on file changes): `docker compose --profile dev up --watch`

### One-command production install (Ubuntu/Debian)

- Blank server deploy: `curl -fsSL https://raw.githubusercontent.com/haoyiyin/basjoo/main/install-deploy.sh | sudo sh`
- Local repo deploy: `sudo sh install-deploy.sh`
- Supported systems: Ubuntu and Debian. The script auto-installs Docker/Compose, clones/syncs the repo, and deploys the production profile.
- Persistent volumes are preserved; `install-deploy.sh` does not remove `backend-data`, `redis-data`, or `qdrant-data`.

### Frontend (`frontend-nextjs/`)

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Build: `npm run build`
- Start production build locally: `npm run start`
- Lint: `npm run lint`
- Type-check: `npm run typecheck`
- Run tests: `npm run test`

### Widget (`widget/`)

- Install deps: `npm install`
- Dev bundle/example server: `npm run dev`
- Build distributables: `npm run build` (typecheck + dev + prod bundles)
- Dev-only build: `npm run build:dev` (unminified ESM, `dist/basjoo-widget.js`)
- Prod-only build: `npm run build:prod` (minified IIFE, `dist/basjoo-widget.min.js`)
- Type-check: `npm run typecheck`
- Run tests: `npm run test`

### Root-level E2E tests (Playwright)

- Smoke tests (dev env): `npm run test:e2e`
- All test projects: `npm run test:e2e:all`
- Production-like E2E: `npm run test:e2e:prod`
- Widget cross-origin embed: `npm run test:e2e:widget`
- Sync widget bundle to backend: `npm run sync-widget`

### Backend (`backend/`)

- Install deps: `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
- Run app locally: `python3 main.py`
- Run all tests: `pytest`
- Run one test file: `pytest tests/test_api.py`
- Run one test: `pytest tests/test_api.py::test_name`
- Test discovery is configured by `backend/pytest.ini` (`tests/`, `test_*.py`, `Test*`, `test_*`)
- Health check while developing locally: `curl http://localhost:8000/health`

## Architecture

### Backend request flow

- `backend/main.py` creates the FastAPI app, mounts auth plus `/api/v1` routers, configures CORS/i18n/rate limiting, and starts schedulers/Redis in non-test mode.
- CORS behavior is intentionally split between Starlette `CORSMiddleware` for normal requests and `apply_cors_headers()` from `backend/middleware/rate_limit.py` for early responses such as rate-limit/413 paths. Keep those in sync via the shared helper; do not add ad-hoc CORS header logic elsewhere.
- `Origin: null` is only allowed when `cors_allow_null_origin` is explicitly enabled in config; missing `Origin` headers should not receive wildcard CORS.
- `backend/config.py` centralizes settings. Secrets can come from env vars or on-disk key files; missing/insecure `SECRET_KEY` values are auto-generated and persisted. The default widget agent ID is also persisted to `/app/data/.agent_id`, and can be overridden with `DEFAULT_AGENT_ID`.
- `backend/database.py` sets up the async SQLAlchemy engine/sessionmaker and initializes default workspace/agent data using the configured persistent default agent ID.
- `backend/models.py` is the system-of-record schema: workspace/agent config, URL and QA knowledge sources, document chunks, chat sessions/messages, quotas, index jobs, and admin users.

### Chat, RAG, and indexing

- Main chat APIs live in `backend/api/v1/endpoints.py`. They handle admin config APIs, public chat APIs, SSE streaming, session creation, quota checks, widget origin whitelist checks, and source normalization.
- URL and Q&A ingestion lives in `backend/api/v1/url_endpoints.py`. Those routers are admin-protected at the router level; URL creation queues async fetch jobs, and refetch/crawl/import operations feed the same knowledge-source tables.
- Full index rebuilds live in `backend/api/v1/index_endpoints.py`. Those routes are also admin-protected at the router level; rebuild jobs chunk URL/QA content, persist `DocumentChunk` rows, and replace the agent’s Qdrant collection.
- Retrieval/storage logic is split across `backend/services/qdrant_store.py`, `backend/services/rag_qdrant.py`, `backend/services/scraper.py`, `backend/services/crawler.py`, and `backend/services/llm_service.py`.
- URL safety/SSRF checks are centralized in `backend/services/url_safety.py` and reused by both schema validation and scraper fetch/discovery flows. If URL-ingestion policy changes, update the shared safety helper rather than reintroducing regex-only validation in multiple places.
- `backend/services/llm_service.py` is the provider abstraction layer. Provider selection is driven by `Agent.provider_type`; many providers are implemented via OpenAI-compatible base URLs, while OpenAI Native and Google have dedicated paths.
- Task concurrency for fetch/rebuild operations is guarded by the shared task lock service used by the URL and index endpoints.

### Frontend structure

- The Next.js app uses the App Router under `frontend-nextjs/app/`, with route groups for auth pages and dashboard pages.
- Most page logic is delegated into `frontend-nextjs/src/views/`; shared UI/components live in `frontend-nextjs/src/components/`.
- `frontend-nextjs/src/context/AuthContext.tsx` stores admin auth state in `localStorage` and powers `RequireAuth`-guarded dashboard routes.
- `frontend-nextjs/src/services/api.ts` is the main frontend API client. It handles bearer auth, locale propagation, and SSE parsing for `/api/v1/chat/stream`.

### Widget structure

- `widget/src/BasjooWidget.tsx` is a self-contained embeddable widget implementation bundled with esbuild.
- The widget auto-detects `apiBase`, streams chat via SSE, persists visitor/session IDs in `localStorage`, and polls for human-takeover replies.
- Backend `/sdk.js`, `/basjoo-logo.png`, and widget demo routes are served directly from `backend/main.py`.

### Deployment notes

- `docker-compose.yml` defines shared Redis/Qdrant plus separate dev/prod backend/frontend services.
- `install-deploy.sh` is the one-command production installer for Ubuntu/Debian. It wraps `deploy.sh` and handles Docker/Compose installation, repo clone/sync, and post-deploy health checks.
- The active frontend container is `frontend-nextjs`; compose and nginx configs route traffic to that app, not the legacy frontend.
- Nginx should allow bodies larger than the backend guard: `nginx/conf.d/default.conf` sets `client_max_body_size 12m` so oversized requests reach FastAPI and return JSON 413 responses.
- Optional HTTPS is enabled by `nginx/docker-entrypoint.sh` only when readable cert/key files exist in `./ssl`; otherwise the stack stays in HTTP-only mode.
- When HTTPS is enabled, nginx redirects HTTP requests to HTTPS automatically.
- `SERVER_DOMAIN` can be passed to nginx to enforce a canonical host: matching hostnames are served, direct IP/other-host access is dropped with nginx 444, and `/health` stays available for probes.

## Testing notes

- Backend tests use `backend/tests/conftest.py` to force `BASJOO_TEST_MODE=1`, create isolated SQLite DBs under `backend/.pytest_dbs/`, and monkeypatch Qdrant/Jina/LLM integrations for most API tests.
- Use the existing `client` fixture for authenticated admin API tests and `public_client` for unauthenticated/public-route coverage instead of building ad-hoc `AsyncClient` fixtures in individual test files.
- If a test depends on real Redis/Qdrant hostnames, the fixtures auto-fallback between container hostnames and localhost.

## Environment and configuration

The backend reads settings from environment variables and `.env` via `pydantic-settings`. Key variables:

- `DATABASE_URL`, `REDIS_URL`, `QDRANT_HOST`, `QDRANT_PORT`
- `SECRET_KEY` / `SECRET_KEY_FILE` — auto-generated and persisted if missing
- `DEFAULT_AGENT_ID` — persisted to `/app/data/.agent_id` for widget embed stability
- `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` — Fernet key for stored provider API keys; auto-generated if missing
- `JINA_API_KEY`, `DEEPSEEK_API_KEY`
- `ALLOWED_ORIGINS`, `ALLOWED_METHODS`, `ALLOWED_HEADERS`
- `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST_SIZE`
- `LOG_LEVEL`, `SERVER_DOMAIN`
- `REQUIRE_SECRET_KEY` — set `true` in production to reject insecure secret keys
- `cors_allow_null_origin` — boolean, default `false`; controls `Origin: null` CORS behavior

Default dev ports: Frontend `3000`, Backend `8000`, Qdrant `6333`, Redis `6379`.

## Security model

- **SSRF protection**: `backend/services/url_safety.py` validates all user-provided URLs, blocking localhost, direct IP literals, embedded credentials, and hostnames resolving to private/special-use IPs. DNS results are cached (512-entry LRU).
- **Widget origin whitelist**: Public chat routes enforce a per-agent origin whitelist; admin users bypass it for testing.
- **CORS policy**: Early responses (429, 413) apply CORS through `apply_cors_headers()` in `backend/middleware/rate_limit.py`. `Origin: null` only gets wildcard CORS when `cors_allow_null_origin` is enabled. Missing `Origin` headers get no CORS.
- **Task concurrency**: Shared `TaskLock` prevents conflicting rebuild/fetch operations on the same agent.
