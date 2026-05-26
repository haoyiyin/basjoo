# Repository Guidelines

## Project Structure & Module Organization

Basjoo is a Docker-oriented AI support platform. The FastAPI backend is in `backend/`: routers in `backend/api/`, business logic in `backend/services/`, models in `backend/models.py`, migrations in `backend/migrations/`, static assets in `backend/static/`, and tests in `backend/tests/`. The admin UI is `frontend-nextjs/`, with routes in `app/` and reusable code in `src/components`, `src/views`, `src/hooks`, `src/services`, and `src/locales`. The widget is in `widget/`, with source in `widget/src/`, examples in `widget/example/`, and tests in `widget/tests/`. Root `tests/e2e/` contains Playwright specs. Infrastructure lives in `nginx/`, `r2r-config/`, `scrapling-service/`, `scripts/`, and `docker-compose.yml`.

## Build, Test, and Development Commands

- `docker compose --profile dev up --watch`: start the development stack.
- `cd backend && python3 main.py`: run the API locally after installing `backend/requirements.txt`.
- `cd backend && pytest`: run backend tests.
- `cd frontend-nextjs && npm run dev`: start the admin UI on port 3000.
- `cd frontend-nextjs && npm run build && npm run typecheck && npm run test`: verify frontend changes.
- `cd widget && npm run dev`: build and serve the widget example.
- `cd widget && npm run build`: typecheck and produce widget bundles.
- `npm run test:e2e`: run Playwright smoke tests from the repository root.
- `npm run sync-widget`: copy the widget bundle into backend static assets.

## Coding Style & Naming Conventions

Use 4-space indentation for Python and 2-space indentation for TypeScript/React. Python modules, tests, and functions use `snake_case`; React components and view files use `PascalCase`; hooks use `useSomething`. Keep API routers thin and reusable behavior in `backend/services/`. Prefer explicit TypeScript types over `any`.

## Testing Guidelines

Backend tests follow `backend/pytest.ini`: files named `test_*.py`, classes `Test*`, and functions `test_*`. Add focused tests near the changed domain, using `backend/tests/unit`, `integration`, or top-level regression files as appropriate. Frontend and widget unit tests use Vitest. E2E specs live in `tests/e2e/specs/*.spec.ts`.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:` with concise imperative summaries. Keep commits scoped to one behavior change. Pull requests should include a problem/solution summary, test commands run, linked issues, UI screenshots, and notes for configuration, migrations, or deployment impact.

## Security & Configuration Tips

Do not commit secrets or generated runtime data. Start from `.env.example` and document any new variables. Treat `SECRET_KEY`, provider API keys, database URLs, CORS settings, and encryption keys as sensitive. For production, keep persistent backend data mounted and set `REQUIRE_SECRET_KEY=true`.
