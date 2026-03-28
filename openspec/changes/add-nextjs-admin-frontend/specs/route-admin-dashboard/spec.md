## ADDED Requirements

### Requirement: Next.js Dashboard Service Delivery
The system SHALL build and run the admin dashboard as a dedicated Next.js service in both development and production environments.

#### Scenario: Development stack serves the Next.js dashboard
- **WHEN** the development stack is started
- **THEN** a `frontend-nextjs` development service serves the admin dashboard
- **AND** the service can reach the existing Python backend APIs without replacing them

#### Scenario: Production stack serves the Next.js dashboard
- **WHEN** the production stack is built and started
- **THEN** a `frontend-nextjs` production service serves the admin dashboard
- **AND** the service uses a production-ready standalone build output

### Requirement: Root Traffic Cutover
The system SHALL route the main admin dashboard entrypoint to the Next.js service while preserving the existing backend-served public endpoints.

#### Scenario: Root path serves the Next.js dashboard
- **WHEN** a browser requests `/`
- **THEN** the reverse proxy forwards dashboard traffic to the Next.js frontend service

#### Scenario: Backend public endpoints remain unchanged
- **WHEN** a client requests `/api/*`, `/sdk.js`, `/widget-demo`, `/basjoo-logo.png`, or `/health`
- **THEN** the request continues to resolve through the existing Python backend or its current proxy mapping
- **AND** this migration does not move those endpoints into Next.js

### Requirement: Backend API Preservation During Cutover
The system SHALL migrate the admin frontend without introducing replacement Next.js API routes for the existing Python admin and RAG APIs.

#### Scenario: Admin actions continue to call Python APIs
- **WHEN** an administrator performs login, settings, knowledge, session, or chat actions from the new dashboard
- **THEN** the requests continue to use the existing Python endpoints and response contracts
