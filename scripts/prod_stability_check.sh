#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1}"
ADMIN_EMAIL="${AUTORESEARCH_ADMIN_EMAIL:-autoresearch-admin@example.com}"
ADMIN_PASSWORD="${AUTORESEARCH_ADMIN_PASSWORD:-AutoresearchPass123!}"
ADMIN_NAME="${AUTORESEARCH_ADMIN_NAME:-Autoresearch Admin}"
TMP_DIR="${TMPDIR:-/tmp}/basjoo-prod-stability"
COOKIE_JAR="$TMP_DIR/cookies.txt"
HEADERS_FILE="$TMP_DIR/headers.txt"
BODY_FILE="$TMP_DIR/body.json"
STREAM_FILE="$TMP_DIR/stream.txt"
LOG_SCAN_FILE="$TMP_DIR/logscan.txt"
METRICS_FILE="$TMP_DIR/metrics.env"
mkdir -p "$TMP_DIR"
: > "$COOKIE_JAR"

PASS_COUNT=0
FAIL_COUNT=0
ERROR_PENALTY=0
LATENCY_PENALTY=0
FUNCTIONAL_TOTAL=0
CONCURRENCY_TOTAL=0
CONCURRENCY_SUCCESS=0
HTTP5XX=0
TIMEOUTS=0
LOG_ERRORS=0
P95_MS=0
STREAM_EVENTS=0

record_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  FUNCTIONAL_TOTAL=$((FUNCTIONAL_TOTAL + 1))
}

record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FUNCTIONAL_TOTAL=$((FUNCTIONAL_TOTAL + 1))
  ERROR_PENALTY=$((ERROR_PENALTY + 8))
}

log_step() {
  printf '\n==> %s\n' "$1"
}

request_json() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  shift 3 || true
  local extra_args=("$@")
  local curl_args=(-sS -X "$method" "$url" -D "$HEADERS_FILE" -o "$BODY_FILE" -w '%{http_code}')
  if [[ -n "$data" ]]; then
    curl_args+=( -H 'Content-Type: application/json' --data "$data" )
  fi
  if [[ ${#extra_args[@]} -gt 0 ]]; then
    curl_args+=("${extra_args[@]}")
  fi
  curl "${curl_args[@]}"
}

extract_json() {
  local python_expr="$1"
  python3 - <<'PY' "$BODY_FILE" "$python_expr"
import json, sys
path, expr = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
print(eval(expr, {'data': data}))
PY
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name" >&2
    exit 2
  fi
}

log_step "Checking required environment"
require_env DEEPSEEK_API_KEY
require_env JINA_API_KEY

log_step "Starting Docker prod stack"
docker compose --profile prod up -d --build > "$TMP_DIR/compose-up.log" 2>&1

log_step "Waiting for services"
python3 - <<'PY' "$BASE_URL"
import sys, time, urllib.request
base_url = sys.argv[1]
urls = [f"{base_url}/health", f"{base_url}/", f"{base_url}/api/admin/register"]
deadline = time.time() + 240
last_error = None
while time.time() < deadline:
    ok = 0
    for url in urls:
        try:
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status < 500:
                    ok += 1
        except Exception as exc:
            last_error = exc
    if ok >= 2:
        sys.exit(0)
    time.sleep(2)
print(f"Timed out waiting for services: {last_error}", file=sys.stderr)
sys.exit(1)
PY

log_step "Health checks"
status=$(request_json GET "$BASE_URL/health" "")
if [[ "$status" == "200" ]]; then
  record_pass
else
  record_fail
fi

root_status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/")
if [[ "$root_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

sdk_status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/sdk.js")
if [[ "$sdk_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

widget_demo_status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/widget-demo")
if [[ "$widget_demo_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Registering admin if needed"
register_payload=$(python3 - <<'PY' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_NAME"
import json, sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2], "name": sys.argv[3]}))
PY
)
register_status=$(request_json POST "$BASE_URL/api/admin/register" "$register_payload")
if [[ "$register_status" == "200" || "$register_status" == "403" ]]; then
  record_pass
else
  record_fail
fi

log_step "Logging in admin"
login_status=$(request_json POST "$BASE_URL/api/admin/login" "$register_payload")
if [[ "$login_status" == "200" ]]; then
  record_pass
else
  record_fail
  cat "$BODY_FILE" >&2
  exit 1
fi
TOKEN=$(extract_json "data['access_token']")
AUTH_HEADER="Authorization: Bearer $TOKEN"

log_step "Fetching default agent"
agent_status=$(request_json GET "$BASE_URL/api/v1/agent:default" "" -H "$AUTH_HEADER")
if [[ "$agent_status" == "200" ]]; then
  record_pass
else
  record_fail
  exit 1
fi
AGENT_ID=$(extract_json "data['id']")

log_step "Updating agent provider settings"
agent_update_payload=$(python3 - <<'PY'
import json, os
print(json.dumps({
  "provider_type": "deepseek",
  "api_base": "https://api.deepseek.com/v1",
  "api_key": os.environ["DEEPSEEK_API_KEY"],
  "jina_api_key": os.environ["JINA_API_KEY"],
  "model": os.environ.get("AUTORESEARCH_MODEL", "deepseek-chat"),
  "embedding_model": os.environ.get("AUTORESEARCH_EMBEDDING_MODEL", "jina-embeddings-v3"),
  "enable_context": True,
  "temperature": 0.2,
  "max_tokens": 512,
  "welcome_message": "Autoresearch baseline test"
}))
PY
)
update_status=$(request_json PUT "$BASE_URL/api/v1/agent?agent_id=$AGENT_ID" "$agent_update_payload" -H "$AUTH_HEADER")
if [[ "$update_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Testing upstream AI and Jina connectivity"
ai_status=$(request_json POST "$BASE_URL/api/v1/agent:test-ai-api?agent_id=$AGENT_ID" "" -H "$AUTH_HEADER")
if [[ "$ai_status" == "200" ]]; then
  record_pass
else
  record_fail
fi
jina_status=$(request_json POST "$BASE_URL/api/v1/agent:test-jina-api?agent_id=$AGENT_ID" "" -H "$AUTH_HEADER")
if [[ "$jina_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Importing QA test data"
qa_payload=$(python3 - <<'PY'
import json
items = [
  {"question": "What is Basjoo autoresearch?", "answer": "A production stability validation run."},
  {"question": "How should widget users be treated?", "answer": "They should receive stable responses in production."}
]
print(json.dumps({"format": "json", "content": json.dumps(items), "overwrite": False}))
PY
)
qa_status=$(request_json POST "$BASE_URL/api/v1/qa:batch_import?agent_id=$AGENT_ID" "$qa_payload" -H "$AUTH_HEADER")
if [[ "$qa_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Creating URL source"
urls_payload='{"urls":["https://example.com"]}'
urls_status=$(request_json POST "$BASE_URL/api/v1/urls:create?agent_id=$AGENT_ID" "$urls_payload" -H "$AUTH_HEADER")
if [[ "$urls_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Waiting for URL fetch task to settle"
python3 - <<'PY' "$BASE_URL" "$AGENT_ID" "$TOKEN"
import json, sys, time, urllib.request
base_url, agent_id, token = sys.argv[1:4]
tasks_url = f"{base_url}/api/v1/tasks:status?agent_id={agent_id}"
urls_url = f"{base_url}/api/v1/urls:list?agent_id={agent_id}"
deadline = time.time() + 180
last_tasks = None
last_urls = None
while time.time() < deadline:
    req1 = urllib.request.Request(tasks_url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req1, timeout=10) as resp:
        last_tasks = json.load(resp)
    req2 = urllib.request.Request(urls_url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req2, timeout=10) as resp:
        last_urls = json.load(resp)
    urls = last_urls.get("urls", [])
    all_done = bool(urls) and all(item.get("status") in {"success", "failed"} for item in urls)
    if last_tasks.get("can_modify_index") and all_done:
        print(json.dumps({"tasks": last_tasks, "urls": last_urls}))
        sys.exit(0)
    time.sleep(2)
print(json.dumps({"tasks": last_tasks, "urls": last_urls}))
sys.exit(5)
PY
fetch_wait_status=$?
if [[ "$fetch_wait_status" == "0" ]]; then
  record_pass
else
  record_fail
fi

log_step "Triggering index rebuild"
rebuild_status=$(request_json POST "$BASE_URL/api/v1/index:rebuild?agent_id=$AGENT_ID" '{"force":false}' -H "$AUTH_HEADER")
if [[ "$rebuild_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

JOB_ID=$(extract_json "data['job_id']")
python3 - <<'PY' "$BASE_URL" "$AGENT_ID" "$JOB_ID" "$TOKEN"
import json, sys, time, urllib.request
base_url, agent_id, job_id, token = sys.argv[1:5]
url = f"{base_url}/api/v1/index:status?agent_id={agent_id}"
deadline = time.time() + 180
last = None
while time.time() < deadline:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = json.load(resp)
    last = payload
    if payload.get("status") in {"completed", "failed"} and payload.get("job_id") == job_id:
        print(json.dumps(payload))
        sys.exit(0 if payload.get("status") == "completed" else 3)
    time.sleep(2)
print(json.dumps(last or {}))
sys.exit(4)
PY
rebuild_wait_status=$?
if [[ "$rebuild_wait_status" == "0" ]]; then
  record_pass
else
  record_fail
fi

log_step "Checking index info"
index_info_status=$(request_json GET "$BASE_URL/api/v1/index:info?agent_id=$AGENT_ID" "" -H "$AUTH_HEADER")
if [[ "$index_info_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Blocking chat smoke test"
chat_payload=$(python3 - <<'PY' "$AGENT_ID"
import json, sys
print(json.dumps({
  "agent_id": sys.argv[1],
  "session_id": "autoresearch-blocking-session",
  "message": "Please answer briefly: what is Basjoo autoresearch?"
}))
PY
)
blocking_chat_status=$(request_json POST "$BASE_URL/api/v1/chat" "$chat_payload")
if [[ "$blocking_chat_status" == "200" ]]; then
  record_pass
else
  record_fail
fi

log_step "Streaming chat smoke test"
stream_status=$(curl -sS -N -X POST "$BASE_URL/api/v1/chat/stream?locale=zh-CN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  --data "$chat_payload" \
  --max-time 60 > "$STREAM_FILE" && echo 0 || echo $?)
if [[ "$stream_status" == "0" ]]; then
  STREAM_EVENTS=$(python3 - <<'PY' "$STREAM_FILE"
import sys
text = open(sys.argv[1], 'r', encoding='utf-8').read()
print(text.count('event: '))
PY
)
  if grep -q 'event: done' "$STREAM_FILE"; then
    record_pass
  else
    record_fail
  fi
else
  TIMEOUTS=$((TIMEOUTS + 1))
  record_fail
fi

log_step "Concurrent health and chat load"
python3 - <<'PY' "$BASE_URL" "$AGENT_ID" > "$TMP_DIR/concurrency.json"
import asyncio, json, statistics, sys, time
import httpx
base_url, agent_id = sys.argv[1:3]
health_total = 20
chat_total = 8
latencies = []
results = {"health_ok": 0, "chat_ok": 0, "latencies": []}

async def do_health(client, idx):
    start = time.perf_counter()
    try:
        r = await client.get(f"{base_url}/health", timeout=20)
        ok = r.status_code == 200
    except Exception:
        ok = False
    elapsed = (time.perf_counter() - start) * 1000
    latencies.append(elapsed)
    if ok:
        results["health_ok"] += 1

async def do_chat(client, idx):
    start = time.perf_counter()
    payload = {
        "agent_id": agent_id,
        "session_id": f"autoresearch-concurrency-{idx}",
        "message": "Reply with one short sentence about stability."
    }
    try:
        r = await client.post(f"{base_url}/api/v1/chat", json=payload, timeout=60)
        ok = r.status_code == 200
    except Exception:
        ok = False
    elapsed = (time.perf_counter() - start) * 1000
    latencies.append(elapsed)
    if ok:
        results["chat_ok"] += 1

async def main():
    async with httpx.AsyncClient() as client:
        await asyncio.gather(*([do_health(client, i) for i in range(health_total)] + [do_chat(client, i) for i in range(chat_total)]))
    results["latencies"] = latencies
    print(json.dumps(results))

asyncio.run(main())
PY
read CONCURRENCY_SUCCESS CONCURRENCY_TOTAL P95_MS HTTP5XX <<EOF
$(python3 - <<'PY' "$TMP_DIR/concurrency.json"
import json, math, sys
payload = json.load(open(sys.argv[1]))
latencies = sorted(payload["latencies"])
if latencies:
    idx = max(0, math.ceil(len(latencies) * 0.95) - 1)
    p95 = int(latencies[idx])
else:
    p95 = 0
success = payload["health_ok"] + payload["chat_ok"]
total = 20 + 8
print(success, total, p95, total - success)
PY
)
EOF
if [[ "$CONCURRENCY_SUCCESS" -ge 24 ]]; then
  record_pass
else
  record_fail
fi
if [[ "$P95_MS" -gt 5000 ]]; then
  LATENCY_PENALTY=$((LATENCY_PENALTY + 10))
fi
HTTP5XX=$((HTTP5XX + (CONCURRENCY_TOTAL - CONCURRENCY_SUCCESS)))

log_step "Rate limit stress burst"
python3 - <<'PY' "$BASE_URL" > "$TMP_DIR/burst.json"
import asyncio, json, sys
import httpx
base_url = sys.argv[1]
async def main():
    async with httpx.AsyncClient() as client:
        async def fire(i):
            try:
                r = await client.get(f"{base_url}/health", timeout=10)
                return r.status_code
            except Exception:
                return 0
        statuses = await asyncio.gather(*[fire(i) for i in range(60)])
    print(json.dumps(statuses))
asyncio.run(main())
PY
burst_failures=$(python3 - <<'PY' "$TMP_DIR/burst.json"
import json, sys
statuses = json.load(open(sys.argv[1]))
print(sum(1 for s in statuses if s == 0 or s >= 500))
PY
)
if [[ "$burst_failures" -le 2 ]]; then
  record_pass
else
  record_fail
fi
HTTP5XX=$((HTTP5XX + burst_failures))

log_step "Container log scan"
docker compose --profile prod logs --no-color backend-prod frontend-prod nginx redis qdrant > "$LOG_SCAN_FILE" 2>&1 || true
LOG_ERRORS=$(python3 - <<'PY' "$LOG_SCAN_FILE"
import re, sys
text = open(sys.argv[1], 'r', encoding='utf-8', errors='ignore').read().lower()
patterns = [r'traceback', r'\berror\b', r'exception', r'failed to', r'panic']
count = 0
for p in patterns:
    count += len(re.findall(p, text))
print(count)
PY
)
if [[ "$LOG_ERRORS" -le 20 ]]; then
  record_pass
else
  record_fail
fi
ERROR_PENALTY=$((ERROR_PENALTY + LOG_ERRORS))

score=$((PASS_COUNT * 10 - FAIL_COUNT * 12 - ERROR_PENALTY - LATENCY_PENALTY - TIMEOUTS * 10))

cat > "$METRICS_FILE" <<EOF
PASS_COUNT=$PASS_COUNT
FAIL_COUNT=$FAIL_COUNT
FUNCTIONAL_TOTAL=$FUNCTIONAL_TOTAL
CONCURRENCY_SUCCESS=$CONCURRENCY_SUCCESS
CONCURRENCY_TOTAL=$CONCURRENCY_TOTAL
P95_MS=$P95_MS
HTTP5XX=$HTTP5XX
TIMEOUTS=$TIMEOUTS
LOG_ERRORS=$LOG_ERRORS
STREAM_EVENTS=$STREAM_EVENTS
STABILITY_SCORE=$score
EOF

printf 'STABILITY_SCORE=%s\n' "$score"
printf 'PASS_COUNT=%s\n' "$PASS_COUNT"
printf 'FAIL_COUNT=%s\n' "$FAIL_COUNT"
printf 'CONCURRENCY_SUCCESS=%s/%s\n' "$CONCURRENCY_SUCCESS" "$CONCURRENCY_TOTAL"
printf 'P95_MS=%s\n' "$P95_MS"
printf 'HTTP5XX=%s\n' "$HTTP5XX"
printf 'TIMEOUTS=%s\n' "$TIMEOUTS"
printf 'LOG_ERRORS=%s\n' "$LOG_ERRORS"
printf 'STREAM_EVENTS=%s\n' "$STREAM_EVENTS"
