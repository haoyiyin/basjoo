# Project Context

## Purpose

**Basjoo** is a RAG-based (Retrieval-Augmented Generation) intelligent system that enables businesses to deploy smart chatbots powered by their own knowledge bases. The system supports:

- **Q&A Knowledge Sources**: Curated question-answer pairs for precise responses
- **URL Knowledge Sources**: Automatic web content scraping and indexing
- **Web Widget**: Embeddable chat component for any website
- **Multi-LLM Support**: OpenAI, Anthropic (Claude), Google (Gemini), Azure OpenAI, and compatible APIs
- **Admin Dashboard**: Full management interface for knowledge, agents, and settings

**Status**: Production-ready with 126 passing tests, zero bugs, and SSS+ quality certification.

## Tech Stack

### Backend (`backend/`)
| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.11+ | Runtime |
| FastAPI | 0.115.0 | Async web framework |
| SQLAlchemy | 2.0.35 | Async ORM with aiosqlite |
| FAISS | 1.10.0 | Vector similarity search |
| sentence-transformers | 2.7.0 | Text embeddings |
| APScheduler | 3.10.4 | Background task scheduling |
| Pydantic | 2.10.1 | Request/response validation |
| OpenAI SDK | 1.54.0 | LLM API client |
| Anthropic SDK | 0.40.0 | Claude API client |
| google-generativeai | 0.8.3 | Gemini API client |

### Frontend (`frontend-nextjs/`)
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 14.2.0 | App framework and routing |
| React | 18.3.1 | UI framework |
| TypeScript | ~5.6.2 | Type safety |
| i18next | 25.7.4 | Internationalization (zh-CN, en-US) |
| react-markdown | 10.1.0 | Markdown rendering |

### Widget (`widget/`)
| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | 5.3.0 | Type safety |
| esbuild | 0.19.8 | Bundler (ESM + IIFE outputs) |

### Infrastructure
- **Docker + Docker Compose**: Container orchestration
- **Nginx**: Reverse proxy for frontend
- **SQLite**: Default database (PostgreSQL for production)

## Project Conventions

### Code Style

#### Python (Backend)
- **Imports**: stdlib → third-party → local
- **Naming**: `snake_case` (functions/vars), `PascalCase` (classes), `UPPER_SNAKE` (constants)
- **Type Hints**: Required for all function signatures
- **Validation**: Use Pydantic models for all request/response schemas
- **Async**: All DB operations and HTTP calls must be async
- **Error Handling**: Use `HTTPException` with proper status codes

```python
# Example
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from models import Agent

async def get_agent(agent_id: str, db: AsyncSession) -> Agent:
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
```

#### TypeScript (Frontend)
- **Imports**: React → libraries → components → types
- **Naming**: `PascalCase` (components, types), `camelCase` (vars/funcs), `useCamelCase` (hooks)
- **API Calls**: Always use typed `api` client from `services/api.ts`
- **i18n**: Use translation keys, never hardcoded strings

```typescript
// Example
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import AdminLayout from '../components/AdminLayout'
import { api, Agent } from '../services/api'

const { t } = useTranslation('common')
```

### Architecture Patterns

#### API Design
- **Prefix**: `/api/v1/`
- **Resource Actions**: Use `:action` suffix (e.g., `/api/v1/qa:list`, `/api/v1/index:rebuild`)
- **Pagination**: `skip` and `limit` query parameters
- **Authentication**: JWT tokens via `Authorization: Bearer` header

#### Database
- **ORM**: SQLAlchemy async with `AsyncSession`
- **ID Format**: Prefixed UUIDs (`agt_xxxx` for agents, `qa_xxxx` for Q&A, `url_xxxx` for URLs)
- **Timestamps**: Always use `timezone.utc`
- **Migrations**: Manual scripts in `backend/migrations/`

#### Frontend State
- **No Redux/Zustand**: React Context + local state only
- **Auth**: `useAuth()` hook from `AuthContext`
- **Protected Routes**: Wrap with `<RequireAuth>` component

#### Service Layer
- `llm_service.py`: LLM API abstraction (supports Mock mode)
- `rag.py`: RAG retrieval and response generation
- `vector_store.py`: FAISS index management
- `scraper.py`: URL content extraction via Jina Reader API
- `scheduler.py`: Background tasks with APScheduler

### Testing Strategy

#### Backend Tests
- **Framework**: pytest + pytest-asyncio
- **Location**: `backend/tests/`
- **Coverage**: 126 test cases across 9 categories
- **Categories**: Core API, Production, Stress, Edge Case, Integration, Observability, Extreme Stress, Security, Service Layer

```bash
# Run all tests
cd backend && pytest

# Run specific test file
pytest tests/test_api.py -v

# Run with coverage
pytest --cov=. --cov-report=html
```

#### Frontend
- **Type Checking**: `npx tsc --noEmit`
- **Linting**: `npm run lint` (ESLint)
- **Build Verification**: `npm run build`

### Git Workflow

- **Branching**: Feature branches from `main`
- **Naming**: `feature/`, `fix/`, `refactor/` prefixes
- **Commits**: Conventional commits preferred
- **PRs**: Required for all changes to `main`

## Domain Context

### Core Entities
| Entity | ID Format | Description |
|--------|-----------|-------------|
| Workspace | Integer | Container for one user's resources |
| Agent | `agt_xxxx` | AI assistant configuration (LLM, prompts, settings) |
| QAItem | `qa_xxxx` | Question-answer knowledge pair |
| URLSource | `url_xxxx` | Web page knowledge source |
| ChatSession | `sess_xxxx` | Multi-turn conversation session |

### RAG Flow
1. User sends message → `/api/v1/chat`
2. System retrieves relevant contexts from FAISS index (Q&A + URL content)
3. Contexts are injected into LLM prompt with system prompt
4. LLM generates response with source citations
5. Response includes `sources` array for transparency

### Quota System
- Daily message limits per agent
- Automatic reset at midnight (agent's timezone)
- Tracked in `WorkspaceQuota` model

## Important Constraints

### Anti-Patterns (NEVER do these)
| Don't | Do Instead |
|-------|------------|
| `as any` or `@ts-ignore` | Fix the type properly |
| Hardcoded UI strings | Use i18n translation keys |
| `console.log` in production | Use proper logging |
| Empty catch blocks | Log or handle the error |
| Synchronous DB calls | Use async/await |

### Security Requirements
- SQL injection protection (via SQLAlchemy ORM)
- XSS attack prevention
- Input validation on all endpoints
- Rate limiting via slowapi
- CORS whitelist configuration

### Performance Targets
| Metric | Target | Achieved |
|--------|--------|----------|
| Response time | <100ms | 4.0ms |
| Throughput | >50 req/s | 384.7 req/s |
| Concurrent users | >100 | 1000+ |
| Success rate | >99% | 100% (normal load) |

## External Dependencies

### Required Services
| Service | Purpose | Required |
|---------|---------|----------|
| LLM API | Text generation | Yes (or use Mock mode) |
| Jina Reader API | URL content extraction | Optional |

### Supported LLM Providers
| Provider | Environment Variable | Notes |
|----------|---------------------|-------|
| OpenAI / Compatible | `OPENAI_API_KEY` | Default, works with DeepSeek |
| Anthropic | `ANTHROPIC_API_KEY` | Claude models |
| Google | `GOOGLE_API_KEY` | Gemini models |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | Enterprise deployments |

### Key Configuration
```bash
# Required
SECRET_KEY=your-secret-key

# LLM (choose one, or use Mock mode without any)
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
GOOGLE_API_KEY=xxx
AZURE_OPENAI_API_KEY=xxx

# Optional
JINA_API_KEY=xxx
DATABASE_URL=sqlite:///./basjoo.db
ALLOWED_ORIGINS=http://localhost:3000
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

## File Locations Quick Reference

| Task | Location |
|------|----------|
| Add API endpoint | `backend/api/v1/endpoints.py` or `url_endpoints.py` |
| Add Pydantic schema | `backend/api/v1/schemas.py` |
| Modify DB models | `backend/models.py` |
| Add frontend page | `frontend-nextjs/src/views/` + route entry in `app/(dashboard)/` |
| Modify API client | `frontend-nextjs/src/services/api.ts` |
| Add translations | `frontend-nextjs/src/locales/{lang}/common.json` |
| Backend tests | `backend/tests/` |
| Widget source | `widget/src/BasjooWidget.tsx` |
