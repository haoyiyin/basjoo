# Remove R2R Dependency — Self KB as Sole Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every direct R2R reference (client, config, docker service, legacy routers, docs) so the completed self multi-tenant KB (Qdrant-backed) becomes the sole/default knowledge backend; system starts/runs/tests cleanly without r2r container or R2R_* vars.

**Architecture:** Delete R2R-specific files/services; remove r2r service + related config from docker/.env/config; delete legacy file/url/index R2R routers (kb_document_endpoints + agent KB binding fully replaces); strip model columns + imports; update frontend embedding_provider; add Qdrant service to compose; clean docs/tests. Preserve all self-KB Qdrant/Postgres logic. URL indexing pipeline's ingest path is switched from R2RClient to the self-KB `KbDocumentProcessor` so existing URL sources remain functional.

**Tech Stack:** Python/FastAPI + SQLAlchemy + Qdrant-client, Next.js TS, docker-compose, pytest.

---

### Task 1: Dependency & Config Cleanup

**Files:**
- Modify: `.env.example` (remove R2R section)
- Modify: `backend/config.py` (remove `r2r_api_url`, `r2r_config_dir`)
- Delete: `backend/services/r2r_config_generator.py`

---

### Task 2: Delete R2R Client + RAG Service

**Files:**
- Delete: `backend/services/r2r_client.py`, `backend/services/rag_r2r.py`
- Modify: `backend/services/__init__.py` (remove R2R exports)

---

### Task 3: Clean API Layer — endpoints.py + schemas + provider_helpers

**Files:**
- Modify: `backend/api/v1/endpoints.py` (replace R2R RAG with KbRetrievalService only, remove kb_setup R2R config logic, remove kb_reset R2R collection logic, remove "r2r" embedding_provider references)
- Modify: `backend/api/v1/schemas.py` (remove "r2r" from Literal types)
- Delete: `backend/api/v1/provider_helpers.py` (only contains `get_agent_r2r_client`)
- Modify: `backend/api/v1/index_endpoints.py` (rewrite to use self-KB health or delete)

---

### Task 4: Delete Legacy R2R Routers + Cleanup Services

**Files:**
- Delete: `backend/api/v1/file_endpoints.py` (replaced by kb_document_endpoints.py)
- Modify: `backend/api/v1/url_endpoints.py` (switch R2R ingest to self-KB or mark deprecated)
- Delete: `backend/services/file_index_cleanup.py` (R2R-specific cleanup)
- Modify: `backend/services/url_index_cleanup.py` (switch from R2RClient or delete)
- Modify: `backend/services/scheduler.py` (switch R2R ingest to self-KB or remove)
- Modify: `backend/main.py` (remove deleted router imports)

---

### Task 5: Models + Migrations Cleanup

**Files:**
- Modify: `backend/models.py` (remove `r2r_document_id`, `r2r_collection_id` columns)
- Modify: `backend/sqlite_migrations.py` (remove r2r_document_id migration column)

---

### Task 6: Deployment Cleanup (Docker)

**Files:**
- Modify: `docker-compose.yml` (remove r2r service, add qdrant, update backend depends/env)
- Modify: `backend/Dockerfile`, `backend/Dockerfile.dev` (remove r2r-config mkdir/chown)
- Modify: `backend/docker-entrypoint.py` (remove ensure_r2r_config_directory)
- Modify: `install-deploy.sh` (remove r2r health wait)

---

### Task 7: Frontend Cleanup

**Files:**
- Modify: `frontend-nextjs/src/services/api.ts` (remove 'r2r' from EmbeddingProvider, remove r2r_restart/r2r_healthy)
- Modify: `frontend-nextjs/src/views/KnowledgeBaseSetup.tsx` (remove 'r2r' case)
- Modify: `frontend-nextjs/src/components/KBSetupWizard.tsx` (remove 'r2r' mapping)

---

### Task 8: Test Cleanup

**Files:**
- Modify: `backend/tests/conftest.py` (remove R2R env/fixture/mocks)
- Modify/delete: `backend/tests/test_file_deletion_cleanup.py` (R2R cleanup tests)
- Modify/delete: `backend/tests/test_url_deletion_cleanup.py` (R2R cleanup tests)
- Modify: `backend/tests/test_kb_setup_config_consistency.py` (remove R2R config tests)
- Modify: `backend/tests/test_production_simulation.py` (remove r2r_healthy)
- Modify: `backend/tests/test_integration.py` (remove r2r_healthy)
- Modify: `backend/tests/test_api.py` (remove R2R-related test)
- Delete: `r2r-config/` directory

---

### Task 9: Documentation Cleanup

**Files:**
- Modify: `README.md`, `README.zh-CN.md` (remove R2R badges, update to self-KB)
- Modify: `AGENTS.md` (remove R2R references)
- Modify: `CLAUDE.md` (remove R2R references)

---

### Task 10: Final Verification

Run all acceptance criteria:
1. `grep -ri "r2r" backend/ frontend-nextjs/ docker-compose.yml .env.example README.md`
2. `cd backend && pytest`
3. Manual flow verification
