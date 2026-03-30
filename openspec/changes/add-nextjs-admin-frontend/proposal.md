# Change: Migrate admin dashboard to Next.js App Router

## Why
The current admin dashboard is a Vite-based SPA served by a dedicated nginx frontend container. We want to move the admin UI to Next.js App Router to establish a more modern frontend foundation while keeping the existing Python backend APIs, streaming flows, and deployment model intact.

## What Changes
- Add a new `frontend-nextjs/` admin application built with Next.js App Router and TypeScript.
- Preserve the current admin route structure, major page flows, typed backend API integration, theme behavior, and locale switching.
- Keep authentication client-side by reusing the existing JWT + `localStorage` pattern instead of introducing a new cookie or middleware-based auth flow.
- Keep the Python backend as the only implementation for admin auth, knowledge management, SSE chat streaming, widget assets, and public config.
- Update Docker and nginx so the Next.js app becomes the default admin frontend served at `/` in development and production.

## Impact
- Affected specs: `provide-admin-dashboard`, `route-admin-dashboard`
- Affected code: `frontend-nextjs/`, `docker-compose.yml`, `nginx/conf.d/locations.conf`, supporting frontend assets/config
- Unchanged systems: Python FastAPI APIs, widget SDK contract, backend SSE endpoints, and RAG/indexing services
