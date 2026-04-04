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

### Frontend (`frontend-nextjs/`)

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Type-check: `npm run typecheck`

### Widget (`widget/`)

- Install deps: `npm install`
- Dev bundle/example server: `npm run dev`
- Build distributables: `npm run build`
- Type-check: `npm run typecheck`

### Backend (`backend/`)

- Install deps: `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
- Run app locally: `python3 main.py`
- Run all tests: `pytest`
- Run one test file: `pytest tests/test_api.py`
- Run one test: `pytest tests/test_api.py::test_name`

## Architecture

### Backend request flow

- `backend/main.py` creates the FastAPI app, mounts auth plus `/api/v1` routers, configures CORS/i18n/rate limiting, and starts schedulers/Redis in non-test mode.
- Early responses that bypass Starlette CORS must use `apply_cors_headers()` from `backend/middleware/rate_limit.py` so embedded widget requests still receive CORS headers.
- `backend/config.py` centralizes settings. Secrets can come from env vars or on-disk key files; missing/insecure `SECRET_KEY` values are auto-generated and persisted. The default widget agent ID is also persisted to `/app/data/.agent_id`, and can be overridden with `DEFAULT_AGENT_ID`.
- `backend/database.py` sets up the async SQLAlchemy engine/sessionmaker and initializes default workspace/agent data using the configured persistent default agent ID.
- `backend/models.py` is the system-of-record schema: workspace/agent config, URL and QA knowledge sources, document chunks, chat sessions/messages, quotas, index jobs, and admin users.

### Chat, RAG, and indexing

- Main chat APIs live in `backend/api/v1/endpoints.py`. They handle admin config APIs, public chat APIs, SSE streaming, session creation, quota checks, widget origin whitelist checks, and source normalization.
- URL and Q&A ingestion lives in `backend/api/v1/url_endpoints.py`. URL creation queues async fetch jobs; refetch/crawl/import operations feed the same knowledge-source tables.
- Full index rebuilds live in `backend/api/v1/index_endpoints.py`. Rebuild jobs chunk URL/QA content, persist `DocumentChunk` rows, and replace the agent’s Qdrant collection.
- Retrieval/storage logic is split across `backend/services/qdrant_store.py`, `backend/services/rag_qdrant.py`, `backend/services/scraper.py`, `backend/services/crawler.py`, and `backend/services/llm_service.py`.
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
- The active frontend container is `frontend-nextjs`; compose and nginx configs route traffic to that app, not the legacy frontend.
- Nginx should allow bodies larger than the backend guard: `nginx/conf.d/default.conf` sets `client_max_body_size 12m` so oversized requests reach FastAPI and return JSON 413 responses.
- Optional HTTPS is enabled by `nginx/docker-entrypoint.sh` only when readable cert/key files exist in `./ssl`; otherwise the stack stays in HTTP-only mode.
- When HTTPS is enabled, nginx redirects HTTP requests to HTTPS automatically.
- `SERVER_DOMAIN` can be passed to nginx to enforce a canonical host: matching hostnames are served, direct IP/other-host access is dropped with nginx 444, and `/health` stays available for probes.

## Testing notes

- Backend tests use `backend/tests/conftest.py` to force `BASJOO_TEST_MODE=1`, create isolated SQLite DBs under `backend/.pytest_dbs/`, and monkeypatch Qdrant/Jina/LLM integrations for most API tests.
- If a test depends on real Redis/Qdrant hostnames, the fixtures auto-fallback between container hostnames and localhost.
