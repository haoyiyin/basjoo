## Context
The admin UI now lives in `frontend-nextjs/` as the canonical dashboard application. Historically, the project migrated from a Vite + React admin app in `frontend/` that used React Router, `AuthContext`, `ThemeContext`, `react-i18next`, and a typed `services/api.ts` client; that legacy app has since been removed after the migration stabilized. Production nginx proxies `/` to `frontend-prod` and keeps `/api/*`, `/sdk.js`, `/widget-demo`, `/basjoo-logo.png`, and `/health` on the Python backend.

## Goals / Non-Goals
- Goals:
  - Deliver the admin dashboard from a new Next.js App Router app.
  - Preserve current admin URLs and major page capabilities.
  - Keep JWT auth client-side with `localStorage` persistence.
  - Keep all admin, chat, SSE, and knowledge APIs on the Python backend.
  - Replace the existing frontend service at `/` once the new app is ready.
- Non-Goals:
  - Rewriting backend APIs into Next.js API routes.
  - Changing the widget SDK or public widget embed contract.
  - Introducing cookie-based auth, server-side session validation, or middleware-only route protection.
  - Replacing the existing CSS system with Tailwind or another new styling framework.

## Decisions
- Decision: Create a parallel `frontend-nextjs/` app instead of converting `frontend/` in place.
  - Why: This reduced migration risk, preserved the previous app as a reference/rollback point during implementation, and kept the cutover explicit.
  - Alternatives considered: In-place conversion of `frontend/` would have blurred migration boundaries and made rollback harder.

- Decision: Use Next.js App Router route groups that mirror the current public and protected routes.
  - Why: The existing route map is already stable and depended on by administrators.
  - Alternatives considered: Restructuring routes during migration would create avoidable behavior changes.

- Decision: Keep auth as a client-only guard backed by the current JWT token and admin payload stored in `localStorage`.
  - Why: This matches the existing backend contract and avoids expanding scope into cookies, middleware auth, or server session orchestration.
  - Alternatives considered: Cookie + middleware auth would provide stronger server-side protection, but it would add a new auth mechanism that is outside the requested scope.

- Decision: Reuse the current CSS token/glassmorphism system in `app/globals.css`.
  - Why: The user explicitly chose to keep the existing CSS, and reusing it minimizes UI drift.
  - Alternatives considered: Tailwind or a new component library would increase scope and visual regression risk.

- Decision: Keep the Python backend as the system of record for all admin APIs, streaming chat, and session data delivery.
  - Why: The backend already owns those contracts and the user explicitly chose not to migrate APIs.
  - Alternatives considered: Next.js API routes would duplicate or fragment the current backend responsibilities.

- Decision: Cut production root traffic over to the new Next.js service while preserving current backend proxy targets.
  - Why: The requested rollout replaces the existing admin frontend at `/` without changing backend endpoint ownership.
  - Alternatives considered: Side-by-side rollout was rejected by the user for this change.

## Risks / Trade-offs
- Client-only auth means protected pages are enforced after hydration rather than by server middleware.
  - Mitigation: Keep the auth provider/guard behavior consistent and do not advertise server-protected semantics in this change.

- Running a parallel codebase during migration increases temporary maintenance overhead.
  - Mitigation: Keep the migration scoped to the admin frontend and plan any legacy cleanup as a separate follow-up.

- SSE streaming and session update behavior can regress if origin/proxy handling changes.
  - Mitigation: Preserve the current backend endpoints and explicitly validate playground streaming plus admin session live updates.

## Migration Plan
1. Create `frontend-nextjs/` with Next.js App Router, shared providers, env handling, and global styles.
2. Port shared admin layout, auth/theme/locale behavior, and typed backend API client usage.
3. Port the admin pages to their App Router equivalents, keeping backend integrations unchanged.
4. Add Docker/dev/prod support for the new Next.js service.
5. Update nginx and compose so `/` resolves to the Next.js service while backend endpoints keep their current routing.
6. Validate route parity, auth flows, SSE streaming, session live updates, and deployment behavior before enabling the cutover.

## Open Questions
- None. The migration will use client-only auth guards and will replace the existing frontend at `/` after implementation.