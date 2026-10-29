# AGENTS.md

## Scope
This is the primary reference for AI coding agents (Pi, Claude, Cursor, Aider, etc.) working on the Basjoo repository. **Always read this file, CLAUDE.md, and relevant sections of README.md before starting any task.**

## Project overview
Docker-oriented AI customer support platform:
- FastAPI backend with workspace-scoped knowledge bases (Qdrant-backed RAG), streaming chat (SSE), knowledge ingestion, admin auth, quotas.
- Vite SPA admin dashboard in `frontend-nextjs/` (React 18 + react-router 7; the directory name is a leftover from the former Next.js app).
- Embeddable TypeScript widget in `widget/` (localStorage sessions, SSE, human takeover).
- Supporting: crawl4ai fetcher service (headless Chromium — container `basjoo-crawler`), Qdrant (vector DB), Redis, nginx.
- Persistence is **SQLite only** (`aiosqlite`). There is no PostgreSQL anywhere in the stack.
- All LLM calls go to external providers; embeddings go through a per-KB provider (Jina / SiliconFlow / OpenAI-compatible custom).

## Repository layout
- `backend/` — FastAPI app, `services/` (logic), `api/` (thin routers), `models.py`, `tests/`.
- `frontend-nextjs/` — Vite SPA: `src/App.tsx` (routes), `src/views/`, `src/components/`, `src/hooks/`, `src/services/api.ts`.
- `widget/` — `src/BasjooWidget.tsx`, esbuild bundles, `example/`.
- `scrapling-service/` — crawler microservice (container `basjoo-crawler`): crawl4ai headless Chromium in-process, with the light curl_cffi/httpx + readability path as fallback. The directory and `SCRAPLING_SERVICE_URL` keep the old `scrapling` name — deployment-coupled, do not rename.
- `nginx/` — reverse proxy used only by the `prod` profile.
- `docker-compose.yml` — dev/prod profiles.
- `tests/e2e/` — Playwright specs (root-level, not inside the frontend).

## Required tools and setup
- Dev stack: `docker compose --profile dev up --watch`.
- The project name is pinned as `name: basjoo` in `docker-compose.yml`. Do not remove it and do not add `name:` to a volume: volumes are prefixed with the project name, so without the pin a second checkout (a worktree, a tarball) starts on `basjoo-ui_backend-data` — an empty database that looks like every admin account was lost. Use `-p` only for a deliberately separate stack.
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
- In the dev image, mount the **repo root** and point `SCRAPLING_SERVICE_MAIN` at it, or the 4 `test_scrapling_discover_*` BFS tests self-skip and the green run silently loses that coverage:
  `docker run --rm --network host -e REDIS_URL=redis://127.0.0.1:6379/0 -e SCRAPLING_SERVICE_MAIN=/repo/scrapling-service/main.py -v "$PWD":/repo -w /repo/backend --entrypoint python3 basjoo-backend-dev:latest -m pytest -q -p no:cacheprovider`
  (`--network host` + `REDIS_URL` are both mandatory: with `redis:6379` unresolvable every login test pays a 134 s connect timeout.)
- E2E (smoke, dev env): `npm run test:e2e` (auto-starts `docker compose --profile dev`).
- E2E (prod-like): `npm run test:e2e:prod` (requires `docker compose --profile prod up -d` first).
- E2E (all): `npm run test:e2e:all`. E2E (widget cross-origin): `npm run test:e2e:widget`.
- Docker rebuild: `docker compose --profile dev up -d --build <service>`.
- Health: `curl http://localhost:8000/health`.

## Must-follow conventions
- **Structure**: Backend logic strictly in `backend/services/`; thin routers in `backend/api/`. Models in `backend/models.py`. Frontend views in `src/views/`, shared components in `src/components/`, hooks in `src/hooks/`. Widget self-contained in `widget/src/`.
- **Style**: Python — 4 spaces, snake_case for modules/functions/tests. TypeScript/React — **tabs** (every file in `src/` uses tabs; there is no prettier/editorconfig, so the existing code is the style), PascalCase for components/views, `use*` hooks. Explicit TS types; no `any`.
- **Commits**: Conventional (`feat:`, `fix:`, `docs:`), scoped, imperative. PRs require summary, test commands+output, UI screenshots, migration notes.
- **Security**: Route all URLs through `backend/services/url_safety.py` (SSRF + DNS cache). SSRF is a switch (`SSRF_PROTECTION_ENABLED`, default **off** — a fake-ip/ULA proxy resolver makes the DNS-range rule reject every real site); enabling it turns on the private/link-local/metadata block. Scheme, credential, empty-host, `localhost` and direct-IP-literal checks always run, and `scrapling-service` (container `basjoo-crawler`) mirrors the same split — it is the only SSRF gate on the crawl4ai path (browser in-process) and it validates both the URL and every redirect the light path follows. Widget origin whitelists enforced. Handle CORS/rate-limit via shared middleware helpers.

## Architecture boundaries
- `backend/main.py` owns the app factory, middleware (CORS, i18n, rate-limit, body-size), router mounting (`/api/admin`, `/api/v1`, legacy `/api/tenants`), static asset routes (`/sdk.js`, `/basjoo-logo.png`, `/widget-demo`), and scheduler/Redis lifespan.
- KB stack (`kb_service.py`, `kb_document_processor.py`, `kb_retrieval_service.py`, `qdrant_service.py`):
  - A `KnowledgeBase` exists on its own (`KnowledgeBase` → `KbDocument` → `KbChunk`), scoped by `workspace_id`. It is **not** derived from an agent: `agents.kb_id` is a nullable UNIQUE pointer, so at most one agent uses a KB and a KB can outlive every agent. Create/reset/delete live on `/api/v1/knowledge-bases` (`backend/api/v1/kb_endpoints.py`).
  - Binding is the only link: `PUT /api/v1/agents/{agent_id}/knowledge-base {"kb_id": ...|null}`. Deleting an agent (soft delete) clears `agents.kb_id` in the same transaction — the KB, its documents, its chunks, **and its `URLSource` rows** survive and can be bound to another agent. Never add a "the agent's KB" accessor; go through the binding. Soft-deleted agent purge must not delete `URLSource` (the table is keyed by `kb_id`, not `agent_id`).
  - `URLSource` belongs to the KB (`kb_id` FK, unique `(kb_id, normalized_url)`). There is no `url_sources.agent_id`. `KbDocument.source_agent_id` is optional provenance only.
  - One Qdrant collection per KB (`kb_<12 hex chars>`, Cosine distance), filtered by `workspace_id` only. `Tenant` still exists as a table but **no KB request path reads it** — do not reintroduce tenant-derived isolation.
  - `knowledge_bases.embedding_dimension` is measured by probe (one real embedding call) when the KB is created, so the collection and the provider always agree; on mismatch `qdrant_service` raises instead of silently writing wrong-size vectors.
  - Each KB owns its embedding config (`embedding_provider`, `embedding_model`, `embedding_base_url`, encrypted key). Retrieval and ingestion read the key from the **KB**, never from the agent — that is the #11 fix.
  - Chunking defaults: `chunk_size=512`, `chunk_overlap=64`; embeddings upserted in batches of ≤100.
  - Retrieval: query embed → Qdrant top `top_k * 2` → post-filter by score → cap at `top_k`. Effective threshold = explicit arg > `agent.similarity_threshold` > service default `0.6`. Agent default is `0.01` (`DEFAULT_AGENT_SIMILARITY_THRESHOLD`); the settings slider maps `0–100` → `0.00–0.100` (×1000).
- Task concurrency is guarded by a shared `TaskLock` (`services/task_lock.py`, `TaskType` enum). URL/index/crawl locks are keyed by **`kb_id`** (the parameter inside `task_lock.py` may still be named `agent_id` — pass the KB id as the owner key).
- Widget auto-detects `apiBase` from `<script src>`; persists visitor/session in localStorage; polls `/api/v1/chat/messages` every 3s for human-takeover messages.

## Chat request flow (`POST /api/v1/chat/stream`)
Two phases on purpose — never hold a DB connection while the LLM streams:
1. Short-lived DB session: resolve agent → widget origin whitelist → daily quota → get/create `ChatSession` → if `taken_over`, persist the message and finish → per-minute rate limit (returns `restricted_reply`; keyed on the session when `session_id` is sent, otherwise on the visitor identity — `visitor_id`, else `visitor_ip` — because omitting `session_id` mints a fresh session per request) → **reject empty LLM key with HTTP 400 `detail="Agent has no LLM API key configured"` (SSE code `API_KEY_MISSING`; never set `use_mock_llm=True`)** → load history → KB retrieval → build messages. Session closes here.
2. No DB connection: emit `sources`, stream `content` deltas (plus `thinking_done` when the provider supports it), then `done` with `message_id`/`session_id`/`usage`/`taken_over`. LLM failure falls back to `agent.restricted_reply`. Hard cap 300s. `get_llm_service` returns `MockLLMService` **only** when `use_mock=True` (tests). Missing key + `use_mock=False` raises `ValueError("api_key required")`.

**The provider read runs in its own task; the idle watchdog (`asyncio.wait`, never `asyncio.wait_for`) only emits `: keepalive` + `thinking` and then awaits the SAME task again.** `asyncio.wait_for` on timeout cancels the awaited `__anext__`, which ends the provider generator: the loop breaks with no content and the user silently gets the restricted fallback ~15s in. Constants `STREAM_FIRST_TOKEN_TIMEOUT_SECONDS` / `STREAM_MAX_DURATION_SECONDS` are module-level so tests can patch them. Only a client disconnect (a `CancelledError`) may cancel the pending read.

SSE event names are `sources`, `content`, `thinking_done`, `done`, `error`. Anything else is a bug — the widget parser ignores unknown events.

**Session identity is enforced on the public surface.** `GET /api/v1/chat/messages` requires the owning `visitor_id` (missing or foreign answers `404 Session not found` — the same shape as an unknown session, so existence is never confirmed); `POST /chat/stream` never adopts a `session_id` whose `visitor_id` differs, it mints a fresh public id instead. Session ids are `sess_<agent>_<12 hex>` and the agent id is public in the embed, so they are enumerable: the widget/SDK must send `visitor_id` on the stream AND on both `chat/messages` calls. Admins use the token-protected `/api/v1/admin/sessions*` surface.

## When changing areas
- **New LLM provider**: extend `backend/services/llm_service.py` (`provider_type` branch), update the `Agent` model/config, expose it in `src/components/AISettingsForm.tsx`.
- **New knowledge source type**: extend the shared ingestion path (`services/kb_document_processor.py` + `services/document_parser.py`) and surface it on the **KB-scoped** routes in `backend/api/v1/kb_endpoints.py` (`/knowledge-bases/{kb_id}/urls:*`, `/files:*`, `/index:*`, `/sources:summary`). Unbound KBs are first-class. The `/api/v1/urls:*` / `/files:*` / `/index:*?agent_id=` handlers in `endpoints.py` are one-release aliases that `require_bound_kb` and delegate; do not add new logic there.
- **UI change**: update `src/views/` or `src/components/`; add i18n strings in `src/locales/{zh-CN,en-US}/`; verify responsiveness (admin SPA 375px: no horizontal overflow, tap targets ≥44px). Widget is a separate app — do not restyle it as a side effect of admin work.
- **KB create/bind UX**: KBs are created and bound **outside** the agent. Home card (`AgentPanel`): bound `kb_id` → `/knowledge-bases/${kb_id}` (source management); unbound → `/knowledge-bases?bindAgent=`. The agent list still offers bind / create / skip. Agent sidebar group `navigation.knowledge` (网站管理 / 文件上传) is gone — sources live on the KB page (`KnowledgeBaseDetail` composes `URLManagement` + `FileUploadManagement` with `kbId` from `useParams`). `KBSetupWizard` no longer exists. `Agent.agent_type` and `Agent.channel_mode` are gone; create-agent is name + optional description only.
- **KB status is derived**: `GET /api/v1/agent:kb-status?agent_id=` computes `kb_setup_completed` from the binding plus `KnowledgeBase.status`. `Agent.kb_setup_completed` is a dead column; never read it, and don't put the flag back on the `/api/v1/agent` payload.
- **Chat streaming issues**: inspect SSE in `backend/api/v1/endpoints.py`, `sse_utils.py`, the widget parser, and the error middleware.
- **Indexing/retrieval problems**: check `kb_retrieval_service.py`, `qdrant_service.py`, threshold, `is_indexed` on `URLSource`, and `sources:summary` / `index:status`.
- **Large exploration/analysis**: use `rg`/`search_files` and read targeted ranges rather than dumping whole files (`endpoints.py` is ~2.8k lines after the source-route move).

## Testing and verification (mandatory before claiming done)
- Frontend changes: always `cd frontend-nextjs && npm run build && npm run typecheck && npm run test` (Vitest, `maxWorkers: 1` — several tests mock globals, keep it serial).
- Backend changes: `cd backend && pytest` for the affected tests (fixtures in `conftest.py`: `client`, `public_client`). On a host without the project venv, run them in the dev image: `docker run --rm --network host -e REDIS_URL=… -e QDRANT_URL=… -v "$PWD":/repo -w /repo/backend --entrypoint python3 <backend-dev image> -m pytest -q`.
- **i18n catalogs are compiled, not hand-edited**: `.mo` files are tracked and there is no `msgfmt` in the image or on the dev host. Edit the `.po`, then run `python3 backend/scripts/compile_mo.py` to regenerate every `locales/*/LC_MESSAGES/messages.mo`. `backend/tests/test_i18n_catalog.py` fails on a stale `.mo`, so a message edit that skips the compile shows up as a red test.
- Docker changes: `docker compose --profile dev up --build`.
- E2E or widget: the relevant `npm run test:e2e:*`. **Specs must not call the blocking `POST /api/v1/chat` with a live provider**: a first token can take ~60 s and the 30 s per-test default kills the request. Use `POST /api/v1/chat/stream` and read the SSE body (see the specs' shared helper pattern); reserve the blocking call for a mocked provider.
- Widget bundle: `npm run sync-widget` (builds `widget/` then copies `dist/basjoo-widget.min.js` to `backend/static/sdk.js`). The two files must stay byte-identical; never edit `sdk.js` by hand.
- Major changes: request code review.
- For bugs: reproduce first, then fix (systematic debugging). For features: plan before writing code.

## Subsystem-specific
### Backend RAG / ingestion
- URL pipeline: `POST /knowledge-bases/{kb_id}/urls:create` → `URLSource(kb_id=..., status=pending)` → `process_url_refetch(kb_id=..., ...)` through the fetcher service → content stored → chunk/embed into **that KB** → `is_indexed`. Fetch failure writes `status=failed` + `last_error`; never leave a fetched-and-failed row as `pending` with `last_error IS NULL`.
- Scheduler: recurring refetch of stale `success` rows still requires an agent with `enable_auto_fetch` and a bound `kb_id`. Independent catch-all: every `URLSource` with `status=pending` and `last_fetch_at IS NULL` is fetched (this is what moves the example URL off pending). Do not auto-retry `failed`.
- Example seed (`ensure_example_agent`): login/register only (not `database.py` startup). Two guards — workspace already has any agent, or a KB named `EXAMPLE_KB_NAME`. After commit, queue `process_url_refetch` via `asyncio.create_task`; do not block login.
- Force rebuild vs incremental is controlled by the `force` param on `/knowledge-bases/{kb_id}/index:rebuild` (legacy `/index:rebuild?agent_id=` still aliases).
- File pipeline: `POST /knowledge-bases/{kb_id}/files:upload` writes bytes + a `KbDocument` (status `pending`) → `BackgroundTasks` → `DocumentParser` (pdfplumber / python-docx / openpyxl) → chunk → embedding → Qdrant upsert → status `ready`/`error`.
- Limits: ≤5 files per request, 20 MB per file, extensions `txt md html pdf docx xlsx`.
- **Upload filenames are sanitised before the row exists** (`sanitise_upload_filename` in `kb_document_processor.py`, called by `upload_kb_files`): control chars/NUL stripped, path separators neutralised, Windows device basenames (`CON`, `PRN`, `COM1`…) prefixed with `_`, whitespace collapsed, whole name capped at 200 chars keeping the extension. A name that reduces to nothing is rejected through the per-file `errors[]` channel, never stored unnamed. The DB row, the list API, the download name and the on-disk file must always agree — do not reintroduce a second sanitiser at the disk layer.
- `urls:clear_all` returns `deleted_count` = the number of **URL rows** cleared (same meaning as `files:clear_all`'s document count), plus the `deleted_url_count` / `deleted_doc_count` / `deleted_chunk_count` / `deleted_qdrant_count` / `deleted_files_count` breakdown. Do not re-point `deleted_count` at `counters["docs"]`: a URL that never indexed reports 0 while the list visibly empties.
- `/knowledge-bases/{kb_id}/files:list` reads `KbDocument` (excluding `url_*` rows); `/urls:list` reads `URLSource`.

**KB endpoints are the live path:** lifecycle + sources both live on `/api/v1/knowledge-bases` (`kb_endpoints.py`). Agent-scoped `/api/v1` `files:*` / `urls:*` / `sources:summary` / `index:*` stay as one-release aliases that resolve the KB through `agents.kb_id` and 409 if unbound. `backend/api/v1/kb_document_endpoints.py` and the `/api/tenants/...` KB surface are gone — do not resurrect them.

### Frontend
- Centralized API/SSE client plus the `kbStatus` helper in `src/services/api.ts`.
- Auth state in `src/context/AuthContext.tsx` (localStorage).
- `useAgentKbStatus` hook drives the first-time KB flow.
- **Design system lives in `src/index.css`** — the single source of truth. Tokens (`--text-*`,
  `--space-*`, `--radius-*`, `--weight-*`, `--color-*`, `--shadow-*`) plus the primitive classes
  every view composes: `admin-page`, `page`, `page-header`, `page-title`, `page-actions`,
  `list` / `list-row` / `list-header`, `card`, `stat` / `stat-grid`, `btn*`, `field` / `input` /
  `select` / `switch`, `badge` / `badge-<state>`, `empty`, `sheet`, `mono`. Two contract suites pin
  it: `tests/unit/designTokens.test.ts` (every primitive exists; WCAG contrast computed for BOTH
  themes) and `tests/unit/mobileLayout.test.tsx` (375px: no overflow, ≥44px targets, the mobile
  media-block rules and the ≥1025px ordering). A new class or a token change must keep both green —
  that is the cheapest way to avoid a silent visual regression.
- **Light is the appearance the product actually ships in** (`ThemeProvider` sets `data-theme`;
  light is the default resolve). Check a colour change in light first, dark second.
- **The shell's direction ("C") is warm and single-accent.** The palette is the logo's own yellow
  (`#F9CA02` / `hsl(48 96% 49%)`) as the ONLY saturated colour in the shell, on a warm near-black
  ground (`hsl(30 …)`, not the old blue-grey `hsl(220 …)`); light theme keeps the same warm ground
  and deepens the accent to `hsl(38 92% 26%)` so it clears 4.5:1 as link text. State colours keep
  their own hues (green / orange / red / blue) because they carry meaning, and warning is pushed to
  22° so it can never be mistaken for the brand yellow. Changing a hue means re-running the contrast
  suite — the numbers are asserted by WCAG math, not judged by eye.
- **One signature mark: the accent rail.** "You are here / this is the one you picked" is always a
  3px accent bar on the leading edge — `.list-row::before` on the current row, a sibling layer in
  `AdminLayout` for the active nav item (the nav rows stack at `zIndex: 1`, so the rail must be a
  sibling of the tint, not a child), and the `::after` underline on the active playground tab. Do
  not introduce a second, different "active" treatment. Section headings carry the same accent as a
  3px square via `.card-title::before`; that tick is the only other place the accent decorates.
- Layout rules when adding a view: root `admin-page`, one `page-header` with a single `page-title`,
  actions in `page-actions`, machine strings (ids, model names, counts, quotas) in `mono`. No glass
  surface, no gradient backdrop, no `fontWeight` outside 400/500/600, no literal colour in a `.tsx`.
  Numeric columns (counts, quotas) take `.is-numeric` — right-aligned with tabular figures — because
  they are compared down the column, not read across the row.
- **Nav is four entries, not six**: 首页 `/`, 智能体 `/agents`, 知识库 `/knowledge-bases`,
  账号设置 `/settings/account`. `/sessions` and `/users` are not routes and not nav — do not
  re-add them. `super_admin` sees those four at the root; inside an agent scope it sees
  仪表盘 / 调试区 / 会话中心 / 智能体设置 (four — round 6 removed the 知识库 sidebar door), and
  `support` sees only 会话中心.
- **Agent-scoped 知识库 is a route, not a nav entry**: `/agents/:id/knowledge` still resolves (a bound
  agent redirects to that KB's source page, an unbound one renders an inline bind prompt
  `kb-bind-prompt`), and it is what the legacy `/urls` + `/files` paths redirect to. The door is the
  agent dashboard's knowledge row. The bind prompt's primary action opens the bind sheet on
  `/knowledge-bases?bindAgent=<id>`. That query param is a live contract between
  `KnowledgeBaseSetup.tsx` and `KnowledgeBases.tsx` — keep both ends working.
- The agent-dashboard KB row links to the KB source page and carries **no** rebind control (the `swap`
  icon was removed). Every icon-only control takes its accessible name from the locale files plus a
  `title`, never the glyph. Registry: `src/components/Icon.tsx` (`ICON_NAMES`, currently 19). The
  two unbind controls (KB list + agent list) use `unlink` — a split-chain glyph meaning "break the
  binding" — never `close` (a panel ×).
  Destructive **confirm** primaries keep their words.
- **Rebinding is unbind-then-bind**: detach from either list (the unbind icon beside the bound KB name
  on `/agents`, or beside the bound agent name on `/knowledge-bases`), then use the dashboard's
  `dashboard-kb-bind` (unbound state only). Both icons go through `bindAgentKnowledgeBase(id, null)`.
- **Lists are one system**: `/agents` and `/knowledge-bases` both render `list-header` + `list-row`
  as a shared column grid. Clicking a row opens the record (the name is a link + chevron) while a
  click that originates on a row control — the unbind icon, the row menu — is ignored. Every list has
  an `empty` state with its create action. The header row hides below 768px and rows stack.
- **Agent lifecycle is three states, not two** (`is_active` + `deleted_at`):
  `active` (badge-success, 进行中) · `paused` (`is_active=false`, `deleted_at` NULL → badge-warning, 已停用,
  reversible via `:resume`) · `deleted` (`deleted_at` set → badge-error, 已删除, reversible via `:restore`
  inside a `purge_after` 7-day window). **Only `deleted_at` ends KB ownership**: a paused agent keeps
  `kb_id`, still blocks a competing bind (409) and still blocks KB deletion (409), and still shows as
  `bound_agent`. Every "who owns this KB?" query must filter `Agent.deleted_at.is_(None)` and must not
  look at `is_active` — that predicate was a soft-delete alias before pause existed and reading it
  again lets a paused agent be silently stripped of its KB. The row menu is 停用/启用 + 删除 (never 打开),
  and pause refuses chat (403 `Agent is paused`, SSE code `AGENT_PAUSED`) at both entry points.
- KB rows carry **no unbind and no refresh control**; unbinding happens from the agent side, and every
  panel auto-polls. Clicking a KB's name opens its source page — there is no separate "manage sources"
  action and no inline expand panel.
- **Auto-fetch settings on the KB detail page have no save button**: each control PATCHes
  `updateAgent` on change (inputs debounced, switches immediate) and the card shows an inline
  save state (`playground-status` pattern) with "保存失败" on a failed write. Do not reintroduce a
  save control or an `alert()`.
- Agent creation is the page's primary action: a filled accent button carrying a `+` icon AND the
  action label, in `page-actions`, opening a `sheet` — never an inline form and never an unlabelled
  `+` icon button (an icon-only trigger made the only action on the page its weakest element).
  Escape and backdrop click close it; focus returns to the trigger.
- The agent dashboard (`/agents/:id/dashboard`) shows API status, agent name, user count, session
  count and one status region. It must not render knowledge-base parameters (index size, URL/file
  counts, chunk counts) — those belong to the KB page. Its lower block is a titled section
  (`card-title`, "智能体信息") and the quota is a row of that same label/value list, not a
  floating line under it.
- Playground: if `!agent.api_key_set`, do not open the SSE stream; disable send; keep the
  configure-key banner. Two layouts driven by the same 1025px boundary: from 1025px both panes are
  mounted side by side (settings left in the first grid track, 320px floor / 480px ceiling, chat
  right, each its own scroll, plain `region`s labelled by their heading) and the tab strip is
  hidden; at ≤1024px the tab strip is the only layout and exactly one pane is mounted
  (`?tab=settings|chat`, `role=tabpanel`, roving tabindex). CSS owns the switch
  (`@media (max-width: 1024px)` / `(min-width: 1025px)` in `index.css`), and `Playground.tsx` must
  mirror it with its own `useMediaQuery('(max-width: 1024px)')` — not `useIsMobile`, which is the
  768px admin-shell contract. The rail needs the whole 1025px: below it 320px + a sidebar leaves
  the chat pane under 320px wide and its input 54px.
- The desktop playground shell is a two-track **grid** (`grid-template-rows: auto minmax(0, 1fr)`),
  not a flex row, and `.playground-shell` is pinned to `100dvh` minus its padding. A wrapped flex
  line cannot shrink below its items' content height, so the settings form's 841px set the row
  height and pushed the chat composer ~300px below the fold. Both panes need `min-height: 0`;
  the settings pane owns `overflow-y: auto`. Regression check: at any viewport height the composer
  must be inside the first screen with no page scroll.
- The configure-key banner appears ONCE per layout: the settings rail shows it on desktop (the pane
  that owns the field), the chat tab shows it at ≤1024px (the only pane mounted then). Never both
  on desktop.
- Chat is transparent: `ChatPanel`'s messages node paints no background, so the page surface shows
  through. Bubbles, the composer, the meta chips and the empty-state icon tile keep their own fills.
- Page chrome is transparent everywhere: `.admin-page` is the shared surface and no route adds a
  fill of its own behind it (KB list/detail included). Panels inside may carry `card` surfaces;
  the page must not.
- `ThemeProvider` (in `AppProviders`) applies `data-theme` on `<html>`, which `src/index.css` keys off. Keep it even though `useTheme` itself has no live consumer.

### Widget
- Build produces `dist/basjoo-widget.js` (ESM) and `.min.js` (IIFE); always run `npm run sync-widget` after changes affecting embeds, then commit the regenerated `backend/static/sdk.js`.
- Maintains backward compatibility for existing script embeds (agent ID persistence, `?agent_id=` and `?agentId=` query params).

## Known dead code (do not extend, do not "fix" by wiring up)
Left over from the Next.js → Vite migration. Removing these is a separate cleanup task; touching them inside an unrelated change is noise.

**Frontend**
- `api.clearAgentError` / `useTheme` are now referenced by nothing at all (the accidental `AgentSettings 2.tsx` duplicate that used them was deleted during the UI redesign, along with the accident-twin `package-lock 2.json`). `~100` i18n keys it consumed are unreferenced, as are the `theme.*` keys.
- `src/utils/textSanitizer.ts` — zero imports.
- `src/views/Chat.tsx` + route `/chat/:sessionId` — no link or `navigate()` targets it; `Sessions.tsx` handles messages inline. Orphan route.
- `src/views/Setup.tsx` + route `/setup` — legacy AI-config wizard with no inbound link (`Login.tsx` points at `/register`). Orphan route.
- `"use client"` at the top of some files — Next.js directive, a no-op under Vite.
- Unused methods in `src/services/api.ts`: `checkHealth`, `getIndexInfo`, `listModels`, `discoverURLs`, `getAdminSessions`, `getAdminSessionMessages`, `getJinaKeyStatus`, `updateJinaApiKey`, `clearAgentError`.
  - `clearAgentError` posts to `/api/v1/agent:clear-error`, an endpoint that **does not exist** in the backend. Do not call it.
- ~300 of 680 keys per locale file are unreferenced (`labels.*` bulk, the removed Q&A import feature, playground index-rebuild strings, `theme.*`).

**Backend**
- `backend/services/file_service.py` — imported as `svc_list_files` / `svc_upload_files` / `svc_delete_file` / `svc_clear_all_files` in `endpoints.py` but never called. It is the only writer of `KnowledgeFile`, which is why `Agent.file_count` in `build_agent_config_with_stats` is permanently `0` while `/files:list` returns real `KbDocument` rows (agent cards show 0 files).
- `URLNormalizer` and `check_content_changed` (`services/scraper.py`, re-exported by `services/__init__.py`) — imported, never called. URL normalization actually happens via `models.normalize_url`.
- `POST /api/v1/urls:repair-indexed-status` — one-off data repair from a historical bug, no caller.
- `POST /api/v1/contexts`, `GET /api/v1/models:list` — no product caller (one e2e spec uses `/contexts`). The per-agent embedding routes (`agent:jina-key-status`, `agent:jina-key`, `agent:kb-setup`, `agent:test-jina-api`) were **removed**: embedding config belongs to the KB now.
- `Agent.embedding_provider` / `embedding_model` / `embedding_api_base` / `embedding_batch_size` / `kb_setup_completed` — deprecated columns kept for one release so an old SQLite file still migrates. No code reads or writes them except the migration that backfills the KB.
- `backend/migrations/*.py` (11 scripts, ~930 lines) — nothing invokes them; `backend/sqlite_migrations.py` is the real migration path (auto-runs on startup).
- `bootstrap-env.sh` + `backend/env_bootstrap.py` — copied into the image but never imported by `docker-entrypoint.py`; nothing calls the shell wrapper.
- `IndexJob` model — never instantiated. `/index:rebuild` returns a `job_id` that is never persisted.
- `Tenant` (table + `/api/tenants` router) — the KB stack no longer reads it; workspaces are the isolation unit. `Tenant.slug` / `Tenant.plan`, `ChatSession.visitor_region` — written, never read.

**Repository hygiene**
- Tracked artifacts: `E2E_TEST_REPORT.md`, `E2E_BUG_REPORT.md`, `E2E_RAW_OUTPUT.txt`, `tests/playwright-report/index.html` (559 KB), `widget/example/basjoo-widget.js` (stale build output).
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

Last updated: 2026-10-28 (UI direction C: warm single-accent shell keyed to the logo's yellow, the accent-rail signature mark across nav/rows/tabs, page-header hairline removed, cards at the content radius, filled labelled primary actions, numeric columns right-aligned; playground two-column rebuilt as a viewport-pinned grid so the composer stays on screen, and the configure-key banner appears once per layout; `unlink` glyph replaces × on both unbind controls; crawler container renamed `basjoo-crawler`)
