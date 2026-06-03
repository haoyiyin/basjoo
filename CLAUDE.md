# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

- `frontend-nextjs/` is the active admin/dashboard frontend. Treat the older `frontend/` directory as legacy/reference only.
- `backend/` is a FastAPI app with SQLite persistence, Redis-backed rate limiting/cache fallbacks, and self-KB retrieval/indexing (Qdrant).
- `widget/` builds the embeddable chat widget SDK that talks to the backend streaming chat endpoints.
- `nginx/` contains the reverse-proxy config used in Docker deployments.
- `scrapling-service/` is a standalone FastAPI microservice that performs HTTP fetching with `curl_cffi` (TLS-impersonated Chrome 120) and `readability-lxml` content extraction, with `httpx` fallback when `curl_cffi` fails. The backend talks to it via HTTP on port 8001 (internal Docker network).
- `docker-compose.yml` is the primary local/dev/prod orchestration entrypoint.

## Common commands

### Docker compose

- Start development stack: `docker compose --profile dev up -d`
- Start production-style stack: `docker compose --profile prod up -d`
- Rebuild a service: `docker compose --profile dev up -d --build backend-dev frontend-dev`
- Rebuild scrapling service: `docker compose --profile dev up -d --build scrapling-service`
- Follow logs: `docker compose logs -f backend-dev frontend-dev nginx`
- Watch mode (auto-rebuild on file changes): `docker compose --profile dev up --watch`

### One-command production install (Ubuntu/Debian)

- Blank server deploy: `curl -fsSL https://raw.githubusercontent.com/haoyiyin/basjoo/main/install-deploy.sh | sudo sh`
- Local repo deploy: `sudo sh install-deploy.sh`
- Supported systems: Ubuntu and Debian. The script auto-installs Docker/Compose, clones/syncs the repo, and deploys the production profile.
- Persistent volumes are preserved; `install-deploy.sh` does not remove `backend-data`, `redis-data`, or `postgres-data`.

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

- Smoke tests (dev): `npm run test:e2e` -- auto-starts docker compose --profile dev
- Prod-like E2E: `npm run test:e2e:prod` -- requires docker compose --profile prod up -d first
- All projects: `npm run test:e2e:all`
- Widget cross-origin: `npm run test:e2e:widget`

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
- `backend/models.py` is the system-of-record schema: workspace/agent config, URL knowledge sources, uploaded files, chat sessions/messages, quotas, index jobs, and admin users.

### Chat, RAG, and indexing

- Main chat APIs live in `backend/api/v1/endpoints.py`. They handle admin config APIs, public chat APIs, SSE streaming, session creation, quota checks, widget origin whitelist checks, and source normalization.
- Document ingestion is via `backend/api/v1/kb_document_endpoints.py` (self-KB, tenant-scoped). URL and file upload endpoints have been removed; use the KB document pipeline instead.
  - **URL fetch pipeline**: `create_urls` → DB record (status="pending") → `background_tasks.add_task(fetch_url_task)` → Scrapling fetch → DB update (status="success") → content updated. Self-KB handles indexing via document pipeline.
- Index management is via the self-KB system (`kb_document_endpoints.py`). Legacy index endpoints have been removed.
  - `force=False` (default): only re-ingests URLs where `is_indexed == False`. `force=True`: re-ingests all URLs with `status == "success"`.
- Retrieval/storage logic is in `backend/services/kb_retrieval_service.py`, `backend/services/kb_service.py`, `backend/services/qdrant_service.py`, `backend/services/kb_document_processor.py`, `backend/services/document_parser.py`, and `backend/services/llm_service.py`.
- **Self-KB integration**: `backend/services/kb_service.py` + `backend/services/qdrant_service.py` manage per-tenant Qdrant collections. `backend/services/kb_document_processor.py` handles document parsing, chunking, and embedding via OpenAI-compatible APIs.
  - `/v3/documents` for raw text uses **form data** (`data=data`), not JSON. `collection_ids` and `metadata` must be JSON-encoded strings within form fields. Sending plain JSON will return 422.
  - `/v3/documents` returns 409 Conflict when the same content already exists. The existing document ID is embedded in the error message text (e.g. `Document <uuid> already exists`). `ingest_text` and `ingest_file` both handle 409 by extracting the ID, deleting the old document, and retrying.
  - `/v3/retrieval/search` uses **JSON body** (`json=payload`). Hybrid search requires `use_hybrid_search: true` in `search_settings` — without it, the `hybrid_settings` weights are silently ignored.
  - Collection IDs are cached in a module-level `_collection_cache` dict — never persisted, scoped to the process lifetime.
- **KB scoring**: The self-KB uses Qdrant similarity search. Scores vary by embedding model. The `similarity_threshold` filter defaults to 0.01.
  - Frontend slider: 0-100% maps to 0.00-0.10 internally via `display/1000 = internal`. Default: 10% (0.01).
- **LLM vs embedding distinction**: `backend/services/llm_service.py` is the *chat-completion* provider abstraction (OpenAI, Google, DeepSeek, etc.). Embeddings are managed by the self-KB via OpenAI-compatible embedding APIs (Jina, SiliconFlow, custom).
- URL safety/SSRF checks are centralized in `backend/services/url_safety.py` and reused by both schema validation and scraper fetch/discovery flows. SSRF protection blocks loopback, private, link-local, multicast, and unspecified addresses, plus direct IP literals and embedded credentials. The IANA benchmarking range `198.18.0.0/15` (RFC 2544) is explicitly whitelisted because Python's `ipaddress` incorrectly classifies it as `is_private`, but real public websites are hosted there.
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

- `docker-compose.yml` defines shared Redis/Qdrant/PostgreSQL plus separate dev/prod backend/frontend services.
- `install-deploy.sh` is the one-command production installer for Ubuntu/Debian. It wraps `deploy.sh` and handles Docker/Compose installation, repo clone/sync, and post-deploy health checks.
- The active frontend container is `frontend-nextjs`; compose and nginx configs route traffic to that app, not the legacy frontend.
- Nginx should allow bodies larger than the backend guard: `nginx/conf.d/default.conf` sets `client_max_body_size 12m` so oversized requests reach FastAPI and return JSON 413 responses.
- Optional HTTPS is enabled by `nginx/docker-entrypoint.sh` only when readable cert/key files exist in `./ssl`; otherwise the stack stays in HTTP-only mode.
- When HTTPS is enabled, nginx redirects HTTP requests to HTTPS automatically.
- `SERVER_DOMAIN` can be passed to nginx to enforce a canonical host: matching hostnames are served, direct IP/other-host access is dropped with nginx 444, and `/health` stays available for probes.

## Testing notes

- Backend tests use `backend/tests/conftest.py` to force `BASJOO_TEST_MODE=1`, create isolated SQLite DBs under `backend/.pytest_dbs/`, and monkeypatch LLM integrations for most API tests.
- Use the existing `client` fixture for authenticated admin API tests and `public_client` for unauthenticated/public-route coverage instead of building ad-hoc `AsyncClient` fixtures in individual test files.
- To test actual self-KB integration, run against the Docker dev stack with Qdrant.
- Run tests locally via venv (not system python): `source venv/bin/activate && python3 -m pytest tests/ --ignore=tests/integration/`. The `--ignore` is needed because `tests/integration/test_service_clients.py` imports an unavailable module.
- If a test depends on real Redis hostnames, the fixtures auto-fallback between container hostnames and localhost.

## Environment and configuration

The backend reads settings from environment variables and `.env` via `pydantic-settings`. Key variables:

- `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`
- `SECRET_KEY` / `SECRET_KEY_FILE` — auto-generated and persisted if missing
- `DEFAULT_AGENT_ID` — persisted to `/app/data/.agent_id` for widget embed stability
- `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` — Fernet key for stored provider API keys; auto-generated if missing
- `JINA_API_KEY`, `DEEPSEEK_API_KEY`
- `ALLOWED_ORIGINS`, `ALLOWED_METHODS`, `ALLOWED_HEADERS`
- `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST_SIZE`
- `LOG_LEVEL`, `SERVER_DOMAIN`
- `REQUIRE_SECRET_KEY` — set `true` in production to reject insecure secret keys
- `cors_allow_null_origin` — boolean, default `false`; controls `Origin: null` CORS behavior

Default dev ports: Frontend `3000`, Backend `8000`, Qdrant `6333`, PostgreSQL `5432`, Redis `6379`.

## Security model

- **SSRF protection**: `backend/services/url_safety.py` validates all user-provided URLs, blocking loopback, private, link-local, multicast, and unspecified addresses, plus direct IP literals and embedded credentials. The IANA benchmarking range `198.18.0.0/15` is explicitly whitelisted (Python misclassifies it as `is_private`). DNS results are cached (512-entry LRU).
- **Widget origin whitelist**: Public chat routes enforce a per-agent origin whitelist; admin users bypass it for testing.
- **CORS policy**: Early responses (429, 413) apply CORS through `apply_cors_headers()` in `backend/middleware/rate_limit.py`. `Origin: null` only gets wildcard CORS when `cors_allow_null_origin` is enabled. Missing `Origin` headers get no CORS.
- **Task concurrency**: Shared `TaskLock` prevents conflicting rebuild/fetch operations on the same agent.
