# Changelog

All notable changes to this project should be documented in this file.

This file currently starts from the repository state available in this working copy. Earlier historical releases are not reconstructed here because no prior changelog exists in the repository and this directory is not currently operating as a git repository from Claude Code's perspective.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Next.js admin/dashboard frontend in `frontend-nextjs/` with auth, dashboard, sessions, URLs, Q&A, playground, and system settings flows.
- Embeddable widget package in `widget/` with browser-side session persistence, SSE chat streaming, source rendering, and per-agent origin whitelist support.
- Widget copy auto-translation by visitor locale.
- Offline agent fallback replies plus admin-side error alerts for unavailable upstream model responses.
- FastAPI v1 APIs for chat, streaming chat, agent configuration, URL ingestion, Q&A management, index rebuilds, task status, and admin session access.
- SQLAlchemy models for workspaces, agents, URL sources, Q&A items, document chunks, chat sessions/messages, quotas, index jobs, and admin users.
- Async indexing pipeline that chunks URL and Q&A content and stores vector data in Qdrant.
- Provider abstraction layer supporting OpenAI-compatible providers plus dedicated OpenAI Native and Google integrations.
- Docker Compose dev/prod profiles with Redis, Qdrant, backend, frontend, and nginx services.
- Production stability validation script in `scripts/prod_stability_check.sh`.
- Backend test suite covering API behavior, auth, rate limiting, deployment fallbacks, observability, robustness, and stress scenarios.

### Changed

- Active frontend is `frontend-nextjs/`; the older `frontend/` directory is legacy/reference only.
- nginx request body limit is configured larger than the backend guard so oversized requests can be handled by FastAPI with JSON responses.
- HTTPS enablement in nginx is conditional on readable certificate files mounted under `./ssl`, and HTTP now redirects to HTTPS automatically when certificates are present.
- nginx can now enforce a canonical host via `SERVER_DOMAIN`, dropping direct IP or other-host access with nginx 444 while keeping `/health` available for probes.
- Backend startup persists generated secret keys when configured values are missing or insecure.
- Backend startup now persists the default widget agent ID to `/app/data/.agent_id` so existing widget embeds keep working across normal redeployments.
- Docker Compose dev/prod backend services now accept `DEFAULT_AGENT_ID` so operators can restore or pin a known widget agent ID during migrations.
- System auto-reply settings are merged into a single field in the admin experience.
- URL management feedback, cancellation, crawl polling, and training-state synchronization behavior have been tightened across admin flows.

### Fixed

- Early backend responses that bypass normal CORS middleware apply explicit CORS headers so embedded widget requests continue to work.
- Docker backend startup ensures writable app data ownership for persisted SQLite volumes.
- Client IP extraction is normalized through shared middleware utilities for consistent rate limiting and session creation behavior.

---

If you want to preserve release-by-release history going forward, append dated/versioned sections here whenever you cut a release.