## ADDED Requirements

### Requirement: Next.js Admin Route Parity
The system SHALL deliver the admin dashboard from a Next.js App Router application while preserving the current public and protected route structure used by administrators.

#### Scenario: Public auth routes remain available
- **WHEN** an administrator visits `/login`, `/register`, or `/setup`
- **THEN** the Next.js frontend renders the corresponding public page without requiring an authenticated session

#### Scenario: Protected dashboard routes remain available
- **WHEN** an authenticated administrator visits `/`, `/sessions`, `/chat/[sessionId]`, `/urls`, `/qa`, `/settings/system`, or `/playground`
- **THEN** the Next.js frontend renders the matching admin page at the same URL
- **AND** the page preserves its current backend-backed behavior

### Requirement: Client-side JWT Route Protection
The system SHALL protect admin dashboard routes with the existing JWT token stored in browser `localStorage` and SHALL not require a new cookie-based or server-side auth flow for this migration.

#### Scenario: Unauthenticated visit redirects to login
- **WHEN** a browser without a valid stored admin token requests a protected dashboard route
- **THEN** the client-side auth guard redirects the user to `/login`

#### Scenario: Authenticated session persists across reloads
- **WHEN** a browser reloads the Next.js dashboard while a valid token and admin payload remain in `localStorage`
- **THEN** the dashboard restores the admin session without requiring a new login

### Requirement: Backend Integration Parity
The system SHALL keep the Python backend as the system of record for admin authentication, agent settings, knowledge management, SSE chat streaming, and admin WebSocket updates.

#### Scenario: Playground continues to stream responses from the Python backend
- **WHEN** an administrator sends a playground message from the Next.js dashboard
- **THEN** the frontend uses the existing Python chat streaming endpoint
- **AND** streamed content, sources, and session metadata are rendered in the dashboard

#### Scenario: Session center continues to receive live updates
- **WHEN** an administrator opens the sessions UI in the Next.js dashboard
- **THEN** the frontend connects to the existing Python admin WebSocket endpoint
- **AND** session updates and new messages continue to refresh the UI

### Requirement: Theme and Locale Persistence
The system SHALL preserve the current dashboard theme and locale behaviors in the Next.js frontend.

#### Scenario: Theme preference persists
- **WHEN** an administrator changes the dashboard theme
- **THEN** the selection is stored in browser storage
- **AND** the same theme is restored on the next visit

#### Scenario: Locale preference persists
- **WHEN** an administrator changes the dashboard language
- **THEN** the selection is stored in browser storage
- **AND** translated dashboard content is restored on the next visit
