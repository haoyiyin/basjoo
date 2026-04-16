# Basjoo

English | [简体中文](README.zh-CN.md)

Basjoo is an AI customer-support platform with three main parts:

- a **FastAPI backend** for agent configuration, chat, indexing, auth, and scheduling
- a **Next.js admin/dashboard frontend** in `frontend-nextjs/`
- an **embeddable chat widget** in `widget/` that talks to the backend over HTTP and SSE

The stack also uses **SQLite** for application data, **Redis** for rate limiting/cache-related services, **Qdrant** for vector search, and **nginx** for Docker-based reverse proxying.

## Repository structure

- `backend/` — FastAPI app, data models, chat APIs, auth, ingestion, indexing, tests
- `frontend-nextjs/` — active admin/dashboard UI
- `widget/` — embeddable chat widget bundle
- `nginx/` — Docker nginx config
- `docker-compose.yml` — dev/prod orchestration
- `frontend/` — legacy frontend reference; the active frontend is `frontend-nextjs/`

## Core features

- Configurable AI agents with multiple provider settings
- URL ingestion and Q&A knowledge management
- Qdrant-backed retrieval and index rebuild jobs
- Streaming chat responses over Server-Sent Events
- Embeddable website widget with session persistence
- Widget copy auto-translation by visitor locale
- Per-agent widget domain whitelist for public chat embeds
- Offline agent fallback replies and admin-side error alerts
- Admin authentication and dashboard management flows
- Dockerized development and production-style deployment paths

## Feature walkthrough

### Admin dashboard overview

The admin dashboard is the operational center for configuring agents, reviewing knowledge coverage, and accessing the major management modules.

![English admin dashboard screenshot](resource/screenshots/admin/en-US/dashboard.png)

### Playground and AI configuration

The Playground lets admins test replies, inspect retrieval behavior, and adjust model/provider settings from the same workflow.

![English playground screenshot](resource/screenshots/admin/en-US/playground.png)

### Website knowledge management

The Websites page handles URL ingestion, crawling, auto-fetch settings, and retraining/index-refresh workflows for web content.

![English website management screenshot](resource/screenshots/admin/en-US/websites.png)

### Q&A knowledge management

The Q&A page is used to create, batch import, edit, and rebuild structured question/answer knowledge.

![English Q&A management screenshot](resource/screenshots/admin/en-US/qa.png)

### Session operations

The Sessions page shows live conversations, supports human takeover, and gives operators a single place to monitor visitor activity.

![English sessions screenshot](resource/screenshots/admin/en-US/sessions.png)

### System settings and widget appearance

System Settings covers language/theme preferences, widget appearance, embed behavior, and other operational controls.

![English system settings screenshot](resource/screenshots/admin/en-US/system-settings.png)

### Embedded widget experience

The widget provides the visitor-facing chat window with persisted sessions, multilingual copy, streaming responses, and knowledge-assisted replies.

![English widget screenshot](resource/screenshots/widget/en-US/widget-window.png)

## Tech stack

### Backend

- FastAPI
- SQLAlchemy async + SQLite
- Redis
- Qdrant
- APScheduler
- Provider SDKs for OpenAI-compatible APIs, Anthropic, and Google Gemini

### Frontend

- Next.js 14
- React 18
- TypeScript
- i18next

### Widget

- TypeScript
- esbuild
- Browser-native fetch + SSE handling

## Quick start

### Option 1: Docker Compose

Development stack:

```bash
docker compose --profile dev up -d
```

Production-style stack:

```bash
docker compose --profile prod up -d
```

Useful Docker commands:

```bash
docker compose logs -f backend-dev frontend-dev nginx
docker compose --profile dev up -d --build backend-dev frontend-dev
bash scripts/prod_stability_check.sh
```

### Option 1.5: One-command production install (Ubuntu / Debian)

SSH into a blank Ubuntu or Debian server and run:

```bash
curl -fsSL https://raw.githubusercontent.com/haoyiyin/basjoo/main/install-deploy.sh | sudo sh
```

The script will automatically:

- install `git`, `python3`, Docker Engine, and Docker Compose
- clone the repository if the target directory does not exist yet
- force-sync the existing clone to the latest remote branch state
- deploy the production profile with the existing `deploy.sh` flow

If you already have the repository checked out, you can also run it locally:

```bash
sudo sh install-deploy.sh
```

Optional environment variables:

```bash
BASJOO_DIR=/opt/basjoo
BASJOO_BRANCH=main
BASJOO_REPO_URL=https://github.com/haoyiyin/basjoo
BASJOO_FORCE_CLEAN=1
sh install-deploy.sh
```

Notes:

- Supported systems: Ubuntu and Debian.
- The script intentionally resets the repository to the remote branch state and can remove untracked files when `BASJOO_FORCE_CLEAN=1`.
- Persistent Docker volumes are preserved; the script does not remove `backend-data`, `redis-data`, or `qdrant-data`.
- If `apt-get` / `apt` is missing on the server, the script exits with a clear error because Docker installation cannot be bootstrapped reliably on a broken Debian/Ubuntu base image.

Default dev ports:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- Qdrant: `http://localhost:6333`
- Redis: `127.0.0.1:6379`

### Option 2: Run services locally

#### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

Backend health check:

```bash
curl http://localhost:8000/health
```

#### Frontend

```bash
cd frontend-nextjs
npm install
npm run dev
```

#### Widget

```bash
cd widget
npm install
npm run dev
```

## Common development commands

### Frontend (`frontend-nextjs/`)

```bash
npm install
npm run dev
npm run build
npm run start        # production build locally
npm run lint
npm run typecheck
npm run test         # vitest
```

### Widget (`widget/`)

```bash
npm install
npm run dev          # dev bundle + example server
npm run build        # full build (typecheck + dev + prod bundles)
npm run build:dev    # unminified ESM bundle (dist/basjoo-widget.js)
npm run build:prod   # minified IIFE bundle (dist/basjoo-widget.min.js)
npm run typecheck
npm run test         # vitest
```

### Backend (`backend/`)

```bash
pip install -r requirements.txt
python3 main.py
pytest
pytest tests/test_api.py
pytest tests/test_api.py::test_name
```

### Root-level E2E tests

```bash
npm run test:e2e        # smoke tests (dev environment)
npm run test:e2e:all    # all Playwright test projects
npm run test:e2e:prod   # production-like E2E tests
npm run test:e2e:widget # widget cross-origin embed tests
npm run sync-widget     # sync widget bundle to backend
```

### Docker Compose watch mode (dev)

```bash
docker compose --profile dev up --watch
```

## Environment and configuration

The backend reads settings from environment variables and `.env` via `pydantic-settings`.

Important runtime settings used in the current codebase include:

- `DATABASE_URL`
- `REDIS_URL`
- `QDRANT_HOST`
- `QDRANT_PORT`
- `SECRET_KEY`
- `SECRET_KEY_FILE`
- `DEFAULT_AGENT_ID`
- `JINA_API_KEY`
- `DEEPSEEK_API_KEY`
- `ALLOWED_ORIGINS`
- `ALLOWED_METHODS`
- `ALLOWED_HEADERS`
- `RATE_LIMIT_PER_MINUTE`
- `RATE_LIMIT_BURST_SIZE`
- `LOG_LEVEL`
- `SERVER_DOMAIN`
- `ENCRYPTION_KEY` (optional; auto-generated and persisted if missing)
- `ENCRYPTION_KEY_FILE` (default `/app/data/.encryption_key`)
- `REQUIRE_SECRET_KEY` (set `true` in production to reject insecure secret keys)

Notes:

- If `SECRET_KEY` is missing or insecure, the backend generates one and persists it to `SECRET_KEY_FILE`.
- `DEFAULT_AGENT_ID` can be used to restore or pin a known widget agent ID during migrations; see the deployment section below for the preservation workflow.
- If `ENCRYPTION_KEY` is not set, the backend auto-generates a Fernet key and persists it to `ENCRYPTION_KEY_FILE`; stored provider API keys are encrypted with this key.
- `cors_allow_null_origin` (boolean, default `false`) controls whether `Origin: null` (e.g., `file://` widget preview) receives wildcard CORS headers. Off by default for security.
- `SERVER_DOMAIN` is consumed by the nginx service in the production compose profile to enforce a canonical host and block direct IP/other-host access.
- The dev compose profile sets permissive CORS and local API URLs by default.
- The production compose profile expects mounted persistent backend data under `/app/data`.

## Architecture overview

### Backend

`backend/main.py` builds the FastAPI app and wires together:

- auth routes under `/api/admin`
- v1 APIs under `/api/v1` (chat, agent config, sessions, quotas, task status)
- admin-only routers: `url_endpoints.py` (URL ingestion, Q&A management, crawling) and `index_endpoints.py` (index rebuild jobs) are protected at the router level via `Depends(get_current_admin)`
- public v1 routes: `/api/v1/chat`, `/api/v1/chat/stream`, `/api/v1/contexts`, `/api/v1/config:public`
- CORS middleware with a shared `apply_cors_headers()` helper for early responses (rate limit 429, body size 413)
- i18n middleware
- rate limiting middleware
- Redis and scheduler startup in non-test mode
- static routes for widget assets like `/sdk.js`
- a 10MB request body guard that returns JSON 413 errors before the request reaches downstream handlers

The main backend domains are:

- **Agent config**: provider/model/system-prompt/widget settings
- **Knowledge sources**: URLs and Q&A items, with SSRF protection via `backend/services/url_safety.py`
- **Indexing**: chunking content and rebuilding Qdrant collections; rebuilds replace the entire collection (clear + add)
- **Chat**: session creation, streaming replies, source citations, quota checks
- **Admin auth**: dashboard login and registration
- **Scheduling**: URL fetch scheduler, history cleanup, session auto-close (30-min inactivity timeout)

The main persistent entities in `backend/models.py` are:

- `Workspace`
- `Agent`
- `URLSource`
- `QAItem`
- `DocumentChunk`
- `ChatSession`
- `ChatMessage`
- `WorkspaceQuota`
- `IndexJob`
- `AdminUser`

### Retrieval and provider layer

The retrieval/indexing pipeline spans:

- `backend/api/v1/url_endpoints.py`
- `backend/api/v1/index_endpoints.py`
- `backend/services/qdrant_store.py`
- `backend/services/rag_qdrant.py`
- `backend/services/scraper.py`
- `backend/services/crawler.py`

The LLM abstraction is in `backend/services/llm_service.py`. Provider selection is driven by `Agent.provider_type`. The current code supports OpenAI-compatible providers plus dedicated paths for OpenAI Native and Google.

### Frontend

The active UI is the Next.js app in `frontend-nextjs/`.

- App Router routes live under `frontend-nextjs/app/`
- most screen logic lives in `frontend-nextjs/src/views/`
- shared components live in `frontend-nextjs/src/components/`
- admin auth state is stored in `frontend-nextjs/src/context/AuthContext.tsx`
- API calls and SSE parsing are centralized in `frontend-nextjs/src/services/api.ts`

### Widget

`widget/src/BasjooWidget.tsx` is a self-contained embeddable widget that:

- auto-detects `apiBase` from the script source URL, infers from dev port 3000 → backend 8000, or falls back to `window.location.origin`
- fetches `/api/v1/config:public` on init to resolve `default_agent_id`, widget title/color, and welcome message
- stores visitor/session IDs in `localStorage`
- streams chat replies from `/api/v1/chat/stream` via SSE with a 90-second read timeout and one automatic retry on network errors
- polls `/api/v1/chat/messages?role=assistant` at 3-second intervals during human takeover scenarios
- relies on server-side widget origin whitelist checks when configured

The backend serves widget-related assets directly, including `/sdk.js`.

### Security model

- **SSRF protection**: `backend/services/url_safety.py` validates all user-provided URLs. It blocks `localhost`, direct IP literals, URLs with embedded credentials, and hostnames that resolve to private/special-use IPs (loopback, RFC1918, link-local, cloud metadata). DNS resolution results are cached (512-entry LRU) to avoid repeated lookups during crawls.
- **Widget origin whitelist**: Public chat routes enforce a per-agent origin whitelist configured in the admin dashboard. Admin users bypass the whitelist for testing.
- **CORS policy**: Early responses (rate limit 429, body size 413) apply CORS headers through a shared helper in `backend/middleware/rate_limit.py`. `Origin: null` only receives wildcard CORS when `cors_allow_null_origin` is explicitly enabled. Requests without an `Origin` header do not receive CORS headers.
- **Secret persistence**: `SECRET_KEY`, `DEFAULT_AGENT_ID`, and `ENCRYPTION_KEY` are auto-generated and persisted on first boot if not provided via environment variables, ensuring stable widget embed behavior and encrypted API key storage across redeployments.
- **Task concurrency**: A shared `TaskLock` service prevents conflicting operations (e.g., rebuild blocks fetch, fetch blocks rebuild) on the same agent.

## Testing

Backend tests are under `backend/tests/`.

Key testing behavior from `backend/tests/conftest.py`:

- sets `BASJOO_TEST_MODE=1`
- uses isolated SQLite databases under `backend/.pytest_dbs/`
- monkeypatches Qdrant/Jina/LLM integrations for many tests
- falls back between Docker hostnames and localhost for Redis/Qdrant where needed

Run all tests:

```bash
cd backend
pytest
```

Run a file:

```bash
pytest tests/test_api.py
```

Run a single test:

```bash
pytest tests/test_api.py::test_name
```

## Deployment notes

- `docker-compose.yml` is the main orchestration entrypoint.
- `install-deploy.sh` is the one-command production installer/deployer for Ubuntu and Debian. It can auto-install Docker/Compose, clone the repo, and force-sync an existing clone to the chosen remote branch before deploying.
- The active frontend service is `frontend-nextjs`, not the legacy `frontend/` directory.
- nginx is configured with `client_max_body_size 12m` so oversized requests can reach the backend and return JSON errors instead of nginx HTML errors.
- Optional HTTPS is enabled only when readable certificate and key files exist in `./ssl`.
- When certificates are present, nginx serves HTTPS on port 443 and redirects HTTP requests on port 80 to HTTPS automatically.
- `SERVER_DOMAIN` can be set for the nginx service to enforce a canonical hostname. When set, nginx serves only that host, rejects direct IP or unexpected Host access with nginx 444, and keeps `/health` available for load balancer probes.
- If `SERVER_DOMAIN` is not set, nginx keeps accepting requests by the incoming host as before.
- Backend responses that bypass standard middleware should still apply CORS headers so embedded widget requests do not fail cross-origin.
- The backend persists the default widget agent ID to `/app/data/.agent_id`. As long as the backend data volume is preserved, existing widget embed codes keep working after redeployments.
- If you know an older widget agent ID that must keep working, set `DEFAULT_AGENT_ID=agt_xxxxxxxxxxxx` before first boot of the new deployment.
- Avoid `docker compose down -v` or deleting the backend data volume unless you are intentionally rotating widget/embed identity.
- The one-command installer only force-resets repository files; it does not delete Docker named volumes, so `/app/data` persistence remains intact across redeployments.

### Preserving existing widget embeds across redeployments

Recommended production workflow:

1. Preserve the backend data volume mounted at `/app/data`.
2. Redeploy with `docker compose --profile prod up -d --build`.
3. If you are migrating to a new server and know the old widget `agentId`, set `DEFAULT_AGENT_ID` before starting the backend.
4. Back up at least `/app/data/basjoo.db` and `/app/data/.agent_id`.

Example `.env` snippet for migration:

```bash
SECRET_KEY=
DEFAULT_AGENT_ID=agt_123456789abc
```

If the old data volume is lost and the old `agentId` is unknown, old widget embeds cannot be recovered automatically because the embed code references the previous agent ID directly.

## API surface at a glance

Examples of backend endpoints present in the codebase:

- `/health`
- `/api/admin/login`
- `/api/admin/register`
- `/api/v1/chat`
- `/api/v1/chat/stream`
- `/api/v1/agent:default`
- `/api/v1/urls:create`
- `/api/v1/urls:list`
- `/api/v1/urls:refetch`
- `/api/v1/index:rebuild`
- `/api/v1/index:status`

## Current status

This README reflects the repository as it exists now. If you change deployment flows, provider support, or package scripts, update this file alongside the code.