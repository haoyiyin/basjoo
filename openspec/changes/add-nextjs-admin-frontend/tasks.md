## 1. Scaffolding
- [x] 1.1 Create `frontend-nextjs/` with Next.js App Router, TypeScript, lint/build configuration, and environment handling for backend API access.
- [x] 1.2 Add the base application shell, global styles, shared assets, and provider wiring required for theme, locale, and auth state.

## 2. Shared runtime parity
- [x] 2.1 Port the existing auth, theme, locale, and media-query behaviors into Next-compatible client modules while keeping JWT + `localStorage` semantics unchanged.
- [x] 2.2 Port the typed backend API client and ensure SSE chat streaming plus admin session update integrations continue to use the Python backend.

## 3. Route and page migration
- [x] 3.1 Implement App Router pages for `/login`, `/register`, `/setup`, `/`, `/sessions`, `/chat/[sessionId]`, `/urls`, `/qa`, `/settings/system`, and `/playground`.
- [x] 3.2 Port the shared dashboard layout/components and preserve the existing CSS-based design system.
- [x] 3.3 Port feature flows for dashboard summary, playground testing, URL/Q&A management, session takeover/chat, and system settings.

## 4. Deployment cutover
- [x] 4.1 Add development and production Docker support for `frontend-nextjs/`, including standalone production output.
- [x] 4.2 Update `docker-compose.yml` to run the new Next.js frontend in dev and prod profiles.
- [x] 4.3 Update nginx routing so `/` serves the Next.js dashboard while `/api/*`, `/sdk.js`, `/widget-demo`, `/basjoo-logo.png`, and `/health` keep their current backend routing.

## 5. Validation
- [x] 5.1 Run frontend-nextjs lint, typecheck, and production build validation.
- [x] 5.2 Verify login/logout persistence, route navigation, theme and locale switching, playground streaming, session live updates, and knowledge-management workflows against the existing Python backend.
