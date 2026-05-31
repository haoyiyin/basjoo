# Fix R2R Config Write Permission Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the `Failed to write R2R configuration: [Errno 13] Permission denied: '/app/r2r-config/user_configs/r2r.toml'` error (and similar for r2r.env) that occurs on KB initialization ("初始化" button) after providing embedding API key.

**Architecture:** The root cause is a Docker bind-mount permission mismatch: `docker-compose` mounts host `./r2r-config` (owned by host UID e.g. 501, mode 755) as `/app/r2r-config` inside the backend container; the entrypoint drops privileges to the non-root `basjoo` user (UID typically 999) created in the Dockerfile; `write_text()` in `r2r_config_generator.py:48` then fails because `basjoo` lacks write permission on the mounted tree. The fix keeps the existing shared-volume design (backend writes, R2R reads `/app/user_configs/r2r.toml`) and adds runtime `chown` + pre-creation in entrypoint/Dockerfile (modeled exactly on the existing `ensure_data_directory` logic for `/app/data`). No architecture change, no root execution, no new dependencies.

**Tech Stack:** Python 3.11-slim, Docker bind mounts + named volumes, FastAPI + `pathlib.Path.write_text`, `pwd`/`os.chown` for UID switching.

**Files changed (clear boundaries):**
- `backend/docker-entrypoint.py`: Add `ensure_r2r_config_directory()` (one new function) + one call site in `main()`.
- `backend/Dockerfile`: One RUN mkdir/chown layer for the r2r paths.
- `backend/Dockerfile.dev`: Same RUN (kept in sync, DRY violation accepted because Dockerfiles are intentionally duplicated for dev/prod).
- No changes to `backend/services/r2r_config_generator.py` (YAGNI — the `mkdir(parents=True)` already exists; the permission problem is container-level).
- No new test files (existing `test_kb_setup_config_consistency.py` already exercises `write_r2r_config` via temp dirs; Docker permission is runtime-only and covered by manual `docker compose` verification steps).

---

### Task 1: Add ensure_r2r_config_directory helper to entrypoint

**Files:**
- Modify: `backend/docker-entrypoint.py:40-80` (insert new function immediately after `ensure_data_directory`)

- [ ] **Step 1: Insert the new permission-fixer function (copy/adapt the proven data-dir pattern)**

```python
def ensure_r2r_config_directory():
    """Ensure r2r-config volume mount (and user_configs subdir) is writable by basjoo user.

    This fixes the EACCES when write_r2r_config() runs as non-root after privilege drop.
    Safe on read-only mounts: PermissionError is caught and logged as warning.
    """
    r2r_dir = "/app/r2r-config"
    user_configs_dir = os.path.join(r2r_dir, "user_configs")

    # Create if missing (covers first-run before any volume or when host dir absent)
    if not os.path.exists(r2r_dir):
        print(f"Creating r2r config directory: {r2r_dir}")
        os.makedirs(r2r_dir, exist_ok=True)
    os.makedirs(user_configs_dir, exist_ok=True)

    try:
        user_info = pwd.getpwnam("basjoo")
        uid = user_info.pw_uid
        gid = user_info.pw_gid

        print(f"Fixing permissions for {r2r_dir} (UID={uid})")
        for root, dirs, files in os.walk(r2r_dir):
            try:
                os.chown(root, uid, gid)
                os.chmod(root, 0o755)
            except PermissionError:
                print(f"Warning: cannot chown {root} (read-only mount or insufficient caps)")
                # continue walking — some subpaths may still be fixable
            except Exception as exc:
                print(f"Warning: chown error on {root}: {exc}")

            for dirname in dirs:
                path = os.path.join(root, dirname)
                try:
                    os.chown(path, uid, gid)
                    os.chmod(path, 0o755)
                except Exception:
                    pass

            for filename in files:
                path = os.path.join(root, filename)
                try:
                    os.chown(path, uid, gid)
                except Exception:
                    pass
    except KeyError:
        print("Warning: basjoo user not found, skipping r2r-config chown")
    except Exception as exc:
        print(f"Warning: r2r-config permission fix failed: {exc}")
```

- [ ] **Step 2: Verify the function is syntactically valid (no import change needed — os/pwd already imported)**

Run: `python3 -m py_compile backend/docker-entrypoint.py && echo "Syntax OK"`
Expected: `Syntax OK` (no traceback)

- [ ] **Step 3: Commit the new helper (small, reviewable diff)**

```bash
git add backend/docker-entrypoint.py
git commit -m "fix: add ensure_r2r_config_directory helper (prepares for chown on volume mount)"
```

### Task 2: Call the new helper from main() before privilege drop

**Files:**
- Modify: `backend/docker-entrypoint.py:200-220` (inside the `if os.getuid() == 0:` block)

- [ ] **Step 1: Add the call right after the data-dir ensure (so both dirs are fixed while still root)**

Exact edit location (around line 205):

```python
    if os.getuid() == 0:
        uid, gid = ensure_data_directory()
        ensure_r2r_config_directory()   # <-- ADD THIS LINE

        if uid is not None:
            print("Switching to basjoo user...")
            drop_privileges(uid, gid)
```

- [ ] **Step 2: Re-verify syntax after edit**

Run: `python3 -m py_compile backend/docker-entrypoint.py && echo "Syntax OK"`
Expected: `Syntax OK`

- [ ] **Step 3: Commit the integration point**

```bash
git add backend/docker-entrypoint.py
git commit -m "fix: invoke ensure_r2r_config_directory() while root (before drop_privileges)"
```

### Task 3: Update production Dockerfile with pre-created r2r-config paths

**Files:**
- Modify: `backend/Dockerfile:20-30` (after the data-dir chown RUN)

- [ ] **Step 1: Add mkdir + chown layer (idempotent, only affects image layer when no volume present)**

```dockerfile
# 创建非root用户和数据目录
RUN groupadd -r basjoo && useradd -r -g basjoo basjoo \
    && mkdir -p /app/data /app/.cache /app/r2r-config/user_configs \
    && chown -R basjoo:basjoo /app/data /app/.cache /app/r2r-config /app/r2r-config/user_configs
```

- [ ] **Step 2: Build the prod image to validate the layer (no full stack needed)**

Run: `docker compose --profile prod build backend-prod --no-cache 2>&1 | tail -20`
Expected: successful build, final line contains "naming to docker.io/library/basjoo-backend" or equivalent (no chown errors).

- [ ] **Step 3: Commit Dockerfile change**

```bash
git add backend/Dockerfile
git commit -m "fix: pre-create /app/r2r-config/user_configs with basjoo ownership in prod image"
```

### Task 4: Keep dev Dockerfile in sync (same mkdir/chown)

**Files:**
- Modify: `backend/Dockerfile.dev:20-30` (identical location and change as Task 3)

- [ ] **Step 1: Apply the exact same RUN change to the dev variant**

```dockerfile
# 创建非root用户和数据目录
RUN groupadd -r basjoo && useradd -r -g basjoo basjoo \
    && mkdir -p /app/data /app/.cache /app/r2r-config/user_configs \
    && chown -R basjoo:basjoo /app/data /app/.cache /app/r2r-config /app/r2r-config/user_configs
```

- [ ] **Step 2: Syntax/build check for dev image**

Run: `docker compose --profile dev build backend-dev --no-cache 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 3: Commit the dev parity change**

```bash
git add backend/Dockerfile.dev
git commit -m "fix: pre-create r2r-config paths in dev image (keeps Dockerfile parity)"
```

### Task 5: Manual runtime verification (Docker smoke test)

**Files:** (no code change — verification only)

- [ ] **Step 1: Start the dev stack (or prod) and trigger the exact failing flow**

```bash
# Clean start recommended
docker compose --profile dev down -v
docker compose --profile dev up -d --build
# Wait for healthy (r2r + backend)
sleep 30
docker compose --profile dev ps
```

Expected: all services "healthy" or "running", no permission errors in `docker compose logs backend-dev`.

- [ ] **Step 2: Exercise the KB init endpoint that was failing (use curl or the UI)**

```bash
# Obtain a valid admin token first (or use the test client), then:
curl -X POST "http://localhost:8000/api/v1/agent:kb-setup?agent_id=agt_..." \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"embedding_provider":"jina","jina_api_key":"sk-xxx","embedding_model":"jina-embeddings-v3"}'
```

Expected: HTTP 200 with `"message": "知识库初始化完成..."` (no 500 "Failed to write R2R configuration").

Alternative (if UI preferred): open http://localhost:3000 (frontend-dev), navigate to agent settings, fill Jina key, click "初始化" — success toast instead of red error.

- [ ] **Step 3: Verify the written file is now owned by basjoo inside container and readable by r2r**

```bash
docker compose --profile dev exec backend-dev ls -l /app/r2r-config/user_configs/r2r.toml
# Should show owner "basjoo" (or the numeric UID) and be non-zero size
docker compose --profile dev exec r2r ls -l /app/user_configs/r2r.toml
# Should be readable (no permission error) and contain the [embedding] section with the chosen provider
```

Expected: both commands succeed; r2r sees the config written by backend.

- [ ] **Step 4: Commit the verification evidence (optional but follows "frequent commits" for traceability)**

```bash
git add docs/superpowers/plans/2026-05-30-fix-r2r-config-write-permission.md
git commit -m "docs: add verification steps + evidence that kb-setup now succeeds after permission fix"
```

---

**Self-review checklist (performed before saving plan):**

1. Spec coverage: The only reported symptom ("Failed to write R2R configuration" on kb-setup with embedding key) maps directly to Task 1-5. No other subsystems (R2R container itself, frontend form, encryption of keys, snapshot/restore) are implicated by the errno 13.

2. Placeholder scan: No "TBD", "TODO", "add appropriate error handling", "similar to Task X", or empty code blocks. Every step contains literal runnable commands, exact source snippets, and expected output strings.

3. Type/identifier consistency: `ensure_r2r_config_directory` name is used identically in call site and definition; paths `/app/r2r-config` and `user_configs` match exactly the strings in `r2r_config_generator.py:34`, `docker-compose.yml:231`, and `R2R_CONFIG_PATH`. No renamed symbols.

4. Scope: Single cohesive fix (container permission for one volume). No unrelated features added. YAGNI: no new env vars, no changes to generator logic, no test file bloat.

5. Bite-size: Each checkbox is one terminal command, one small edit, or one build step (<5 min on a typical machine).

Plan complete and saved to `docs/superpowers/plans/2026-05-30-fix-r2r-config-write-permission.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?