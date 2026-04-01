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
- Optional Cloudflare Turnstile verification for public chat
- Offline agent fallback replies and admin-side error alerts
- Admin authentication and dashboard management flows
- Dockerized development and production-style deployment paths

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
npm run lint
npm run typecheck
```

### Widget (`widget/`)

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

### Backend (`backend/`)

```bash
pip install -r requirements.txt
python3 main.py
pytest
pytest tests/test_api.py
pytest tests/test_api.py::test_name
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
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `ALLOWED_ORIGINS`
- `ALLOWED_METHODS`
- `ALLOWED_HEADERS`
- `RATE_LIMIT_PER_MINUTE`
- `RATE_LIMIT_BURST_SIZE`
- `LOG_LEVEL`
- `SERVER_DOMAIN`

Notes:

- If `SECRET_KEY` is missing or insecure, the backend generates one and persists it to `SECRET_KEY_FILE`.
- `DEFAULT_AGENT_ID` can be used to restore or pin a known widget agent ID during migrations; see the deployment section below for the preservation workflow.
- `SERVER_DOMAIN` is consumed by the nginx service in the production compose profile to enforce a canonical host and block direct IP/other-host access.
- The dev compose profile sets permissive CORS and local API URLs by default.
- The production compose profile expects mounted persistent backend data under `/app/data`.

## Architecture overview

### Backend

`backend/main.py` builds the FastAPI app and wires together:

- auth routes under `/api/admin`
- v1 APIs under `/api/v1`
- CORS middleware
- i18n middleware
- rate limiting middleware
- Redis and scheduler startup in non-test mode
- static routes for widget assets like `/sdk.js`

The main backend domains are:

- **Agent config**: provider/model/system-prompt/widget settings
- **Knowledge sources**: URLs and Q&A items
- **Indexing**: chunking content and rebuilding Qdrant collections
- **Chat**: session creation, streaming replies, source citations, quota checks
- **Admin auth**: dashboard login and registration

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

- detects or accepts an `apiBase`
- stores visitor/session IDs in `localStorage`
- streams chat replies from `/api/v1/chat/stream`
- polls for assistant replies after human takeover scenarios
- optionally loads and executes Cloudflare Turnstile before sending messages

The backend serves widget-related assets directly, including `/sdk.js`.

Recent widget and admin behavior highlights:

- widget titles, welcome copy, and restricted/offline reply copy can be localized and auto-translated by visitor locale
- admins can configure offline fallback replies and see backend-side error alerts in the dashboard
- URL fetch/rebuild flows include improved cancellation, polling, and status-sync behavior

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