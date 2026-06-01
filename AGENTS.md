# AGENTS.md

## Scope
This is the primary reference for AI coding agents (Pi, Claude, Cursor, Aider, etc.) working on the Basjoo repository. **Always read this file, CLAUDE.md, and relevant sections of README.md before starting any task.** Follow more specific instructions in `openspec/AGENTS.md` when using spec-driven workflows.

## Project overview
Docker-oriented AI customer support platform:
- FastAPI backend with self-developed multi-tenant KB (Qdrant-backed RAG), streaming chat (SSE), knowledge ingestion, admin auth, quotas.
- Next.js 14 (App Router) admin dashboard in `frontend-nextjs/`.
- Embeddable TypeScript widget in `widget/` (localStorage sessions, SSE, human takeover).
- Supporting: Scrapling microservice, Qdrant (vector DB), Redis, PostgreSQL, nginx.
All LLM calls to external providers; embeddings via self-KB (Jina/SiliconFlow/OpenAI-compatible).

## Repository layout
- `backend/` — FastAPI app, `services/` (logic), `api/` (thin routers), `models.py`, `tests/`.
- `frontend-nextjs/` — `app/` (routes), `src/views/`, `src/components/`, `src/hooks/`, `src/services/api.ts`.
- `widget/` — `src/BasjooWidget.tsx`, esbuild bundles, example/.
- `scrapling-service/` — standalone stealth scraper (curl_cffi + readability).
- `docker-compose.yml` — dev/prod profiles; `nginx/`.
- `tests/e2e/` — Playwright specs.
- `openspec/` — capability specs + change proposals (see its AGENTS.md).

## Required tools and setup
- Dev stack: `docker compose --profile dev up --watch`.
- Backend local: `cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python3 main.py`.
- Frontend: `cd frontend-nextjs && npm install`.
- Widget: `cd widget && npm install`.
- Environment: documented in `.env.example`; `SECRET_KEY`, `ENCRYPTION_KEY`, `DEFAULT_AGENT_ID` auto-persisted to `/app/data/` (preserve volume in prod). Never commit secrets.

## Development commands
- Frontend dev: `cd frontend-nextjs && npm run dev`.
- Frontend verify: `cd frontend-nextjs && npm run build && npm run typecheck && npm run test`.
- Widget dev: `cd widget && npm run dev`.
- Widget build (typecheck + bundles): `cd widget && npm run build`.
- Sync widget to backend: `npm run sync-widget`.
- Backend tests: `cd backend && pytest` (uses `pytest.ini`; `Test*` classes, `test_*` funcs).
- E2E (smoke): `npm run test:e2e`; all: `npm run test:e2e:all`; prod-like: `npm run test:e2e:prod`; widget cross-origin: `npm run test:e2e:widget`.
- Docker rebuild: `docker compose --profile dev up -d --build <service>`.
- Health: `curl http://localhost:8000/health`.

## Must-follow conventions
- **Structure**: Backend logic strictly in `backend/services/`; thin routers in `backend/api/`. Models in `backend/models.py`. Frontend views in `src/views/`, shared in `src/components/`, hooks in `src/hooks/`. Widget self-contained in `widget/src/`.
- **Style**: Python — 4 spaces, snake_case for modules/functions/tests. TypeScript/React — 2 spaces, PascalCase for components/views, `use*` hooks. Explicit TS types; no `any`.
- **Commits**: Conventional (`feat:`, `fix:`, `docs:`), scoped, imperative. PRs require summary, test commands+output, UI screenshots, migration notes.
- **Security**: Route all URLs through `backend/services/url_safety.py` (SSRF + DNS cache). Widget origin whitelists enforced. Handle CORS/rate-limit via shared middleware helpers.

## Architecture boundaries
- `backend/main.py` owns app factory, middleware (CORS, i18n, rate-limit, body-size), router mounting (`/api/admin`, `/api/v1`), scheduler/Redis startup.
- Self-KB integration (`kb_service.py`, `qdrant_service.py`, `kb_document_processor.py`): tenant-scoped document upload/parse/chunk/embed via Qdrant. Per-tenant collections. Similarity search; default similarity_threshold 0.01.
- Task concurrency guarded by shared TaskLock in URL/index endpoints.
- Widget auto-detects `apiBase` from `<script src>`; persists visitor/session in localStorage; polls for human takeover.

## When changing areas
- **New LLM provider**: Extend `backend/services/llm_service.py`, update Agent model/config, expose in Playground UI.
- **New knowledge source type**: Extend ingestion via `backend/api/v1/kb_document_endpoints.py` + `services/kb_document_processor.py` + `services/document_parser.py` (local storage + Qdrant, tenant-scoped).
  - For multi-tenant KB documents: use the new direct pipeline in `backend/api/v1/kb_document_endpoints.py` + `services/kb_document_processor.py` + `services/document_parser.py` (local storage + Qdrant, tenant-scoped).
- **UI change**: Update `src/views/` or `src/components/`; add i18n strings in `src/locales/`; verify responsiveness.
- **Post-agent-creation KB onboarding**: In `src/views/Agents.tsx`, after `api.createAgent` success set `onboardingAgentId`. Triggers `KBSetupWizard` (via `useAgentKbStatus` hook + `kbStatus` API + `kb_setup_completed` flag). On complete/skip call `recheck()` then `navigate("/agents/{id}/dashboard")`.
- **Chat streaming issues**: Inspect SSE in `backend/api/v1/endpoints.py`, widget parser, error middleware.
- **Indexing/retrieval problems**: Check `kb_retrieval_service.py`, `qdrant_service.py`, collection cache, threshold, `is_indexed` flag on URLSource.
- **Large exploration/analysis**: Use `ctx_*` tools (ctx_batch_execute, ctx_execute_file, ctx_search) first.

## Testing and verification (mandatory before claiming done)
- Frontend changes: always `cd frontend-nextjs && npm run build && npm run typecheck && npm run test`.
- Backend changes: `cd backend && pytest` for affected tests (use `conftest.py` fixtures: `client`, `public_client`).
- Use `verification-before-completion` skill; run `lsp_diagnostics` before builds.
- Docker changes: `docker compose --profile dev up --build`.
- E2E or widget: relevant `npm run test:e2e:*`.
- Major changes: request code review via `requesting-code-review` skill.
- For bugs: use `systematic-debugging` skill. For features: `brainstorming` → `writing-plans` → `subagent-driven-development` or `executing-plans`.

## Subsystem-specific
### Backend RAG / ingestion
- URL pipeline: `create_urls` → pending DB → background fetch (Scrapling) → success → content updated. Self-KB handles indexing via document pipeline.
- Force rebuild vs incremental controlled by `force` param in index endpoints.
- Similarity scores are RRF (0.01–0.05 range); frontend % slider maps 0–100 → 0.00–0.10.

**KB Document Pipeline (new, multi-tenant, direct Qdrant)**
- Upload: `POST /api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents` (max 5 files, 20MB, txt/md/html/pdf/docx/xlsx) → pending record + local storage → BackgroundTasks.
- Processing: `DocumentParser` (pdfplumber/python-docx/openpyxl) → `chunk_text` (Recursive equiv, KB params) → OpenAI-compatible embedding → Qdrant batch upsert (≤100) with tenant/kb/doc payload.
- Status: pending → processing → ready/error (with `error_message`).
- Delete: Qdrant filter delete → `kb_chunks` → `kb_documents` → physical file.
- All queries enforce `tenant_id`; use `require_tenant_access` + `KbService.get_knowledge_base`.

**Legacy agent-scoped KB sources (URL / File)**
- Use `backend/services/url_service.py` and `backend/services/file_service.py`.
- Endpoints in `backend/api/v1/endpoints.py` must remain thin (delegate only; no DB logic).
- The multi-tenant KB document pipeline is the preferred path for new work.

### Frontend
- Centralized API/SSE + `kbStatus` helper in `src/services/api.ts`.
- Auth state in `src/context/AuthContext.tsx` (localStorage).
- New `useAgentKbStatus` hook for first-time KB flow.

### Widget
- Build produces `dist/basjoo-widget.js` (ESM) and `.min.js` (IIFE); always run `npm run sync-widget` after changes affecting embeds.
- Maintains backward compatibility for existing script embeds (agent ID persistence).

## Safety and operational notes
- Persistent volumes (`/app/data`, redis-data, postgres-data) critical; `install-deploy.sh` preserves them.
- `Origin: null` CORS only when `cors_allow_null_origin=true`; missing Origin gets no wildcard.
- Ask before destructive ops (full DB reset, prod deploy, archive changes without `--yes`).
- Qdrant collection IDs and task locks are process-scoped or Redis-backed; do not assume cross-restart persistence for caches.

## Pull request checklist
- Run targeted verification commands and include output.
- Update docs, i18n, schemas, or fixtures when behavior changes.
- Call out risks, migrations, or follow-ups.
- After implementation use `finishing-a-development-branch` skill to decide merge/PR/cleanup.
- If conventions or architecture evolve, update this file, CLAUDE.md, or README.

## Skills & tools (Pi harness)
Prefer `ctx_*` family to protect context window. Follow superpowers skills (TDD via `test-driven-development`, etc.) and `subagent-driven-development` for parallel work. Use LSP (`lsp_navigation`, `lsp_diagnostics`), `ast_grep_search` for code intelligence.

**This is living documentation. Update when patterns change.**

Last updated: 2026-05-31 (added KB document direct Qdrant pipeline: tenant-scoped upload/parse/index/delete, `kb_document_endpoints.py`, `KbDocumentProcessor`, `DocumentParser`; updated "New knowledge source type" and "Backend RAG / ingestion" sections)
