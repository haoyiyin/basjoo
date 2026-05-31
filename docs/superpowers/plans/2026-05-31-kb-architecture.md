# KB Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the data layer for multi-tenant + per-agent independent knowledge bases (tenants, knowledge_bases, kb_documents, kb_chunks tables + kb_id on agents) with idempotent per-KB Qdrant collections while preserving all existing functionality and enforcing tenant_id on every tenant-scoped query.

**Architecture:** Extend SQLAlchemy models with four new tables using UUID PKs (stored as String(36)) and redundant tenant_id on documents/chunks. Add optional kb_id FK to existing Agent model. On KnowledgeBase creation (via new KbService), ensure a dedicated Qdrant collection named `kb_{kb_id.hex[:12]}` with model-derived dimension and Cosine distance (幂等). All new service methods require explicit tenant_id parameter and apply `.filter_by(tenant_id=tenant_id)` (or equivalent) before any query. Use existing AsyncSessionLocal/get_db, custom migration scripts, and TDD with focused tests. R2R continues to handle ingestion/retrieval; Qdrant client supplements for collection lifecycle.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 (async), FastAPI, PostgreSQL 16 + pgvector, qdrant-client (AsyncQdrantClient), Pydantic v2 settings, existing sqlite_migrations.py + per-migration scripts pattern, pytest-asyncio.

---

## Implementation Status

✅ **Completed:** All tasks implemented and tested.

### Tasks Completed:
1. ✅ Added qdrant-client dependency and Qdrant settings to config.py
2. ✅ Extended sqlite_migrations.py for kb_id column (idempotent)
3. ✅ Created migration script for agents.kb_id (PG + SQLite)
4. ✅ Added new models (Tenant, KnowledgeBase, KbDocument, KbChunk) + updated Agent
5. ✅ Implemented Qdrant ensure_collection (幂等, dim, Cosine)
6. ✅ Created KbService with tenant-enforced CRUD + collection ensure
7. ✅ Wired new models into database init and verified create_all
8. ✅ Added focused integration tests and verified no regressions

### Files Modified/Created:
- `backend/requirements.txt`: Added qdrant-client==1.13.3
- `backend/config.py`: Added QDRANT_URL, QDRANT_API_KEY, QDRANT_TIMEOUT settings
- `backend/sqlite_migrations.py`: Added kb_id column to agents migration
- `backend/migrations/add_kb_id_to_agents.py`: New migration script
- `backend/models.py`: Added Tenant, KnowledgeBase, KbDocument, KbChunk models + Agent.kb_id
- `backend/services/qdrant_service.py`: New service for Qdrant collection management
- `backend/services/kb_service.py`: New service for KnowledgeBase CRUD with tenant enforcement
- `backend/database.py`: Registered new models in init_db create_all
- `.env.example`: Added Qdrant environment variables
- `backend/tests/test_kb_data_layer.py`: New test file for KB data layer

### Verification:
- All new unit tests pass: `python3 -m pytest tests/test_kb_data_layer.py -v`
- No regressions in existing test suite (2 pre-existing failures unrelated to our changes)

**Status:** ✅ COMPLETE
