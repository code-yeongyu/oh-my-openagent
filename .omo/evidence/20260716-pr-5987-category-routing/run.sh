#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVIDENCE="$ROOT/.omo/evidence/20260716-pr-5987-category-routing"
SANDBOX="$(mktemp -d)"
cleanup() { kill "${FAKE_PID:-}" 2>/dev/null || true; rm -rf "$SANDBOX"; }
trap cleanup EXIT

REAL_DB="$(opencode db path)"
BEFORE="$(sqlite3 "$REAL_DB" 'select count(*) from session')"
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_STATE_HOME="$SANDBOX/state" XDG_CACHE_HOME="$SANDBOX/cache"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
mkdir -p "$XDG_CONFIG_HOME/opencode" "$SANDBOX/project"

node "$EVIDENCE/fake-category-server.mjs" >"$EVIDENCE/fake-server.txt" 2>&1 & FAKE_PID=$!
for _ in $(seq 1 50); do grep -q '^PORT=' "$EVIDENCE/fake-server.txt" && break; sleep 0.1; done
PORT="$(sed -n 's/^PORT=//p' "$EVIDENCE/fake-server.txt" | head -1)"
test -n "$PORT"

cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSON
{
  "plugin": ["file://$ROOT/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "agent": {
    "probe-parent": {"mode":"primary","model":"openai/gpt-fake","prompt":"Run the requested probe.","permission":{"task":"allow"}},
    "probe-worker": {"mode":"subagent","model":"openai/gpt-fake","prompt":"Complete the child probe."}
  },
  "provider": {"openai":{"options":{"apiKey":"fake","baseURL":"http://127.0.0.1:$PORT/v1"},"models":{"gpt-fake":{"tool_call":true,"limit":{"context":200000,"output":8192}}}}},
  "permission": {"task":"allow"}
}
JSON
cat >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json" <<'JSON'
{"agents":{"probe-parent":{"category_target_agent":"probe-worker"}}}
JSON

opencode run --agent probe-parent --auto --format json --dir "$SANDBOX/project" "CATEGORY_ROUTE_PROBE" >"$EVIDENCE/allowed-run.jsonl" 2>"$EVIDENCE/allowed-run.stderr"
grep -q 'CHILD_DONE' "$EVIDENCE/allowed-run.jsonl"
sqlite3 "$XDG_DATA_HOME/opencode/opencode.db" "select data from message" | grep -q '"agent":"probe-worker"'

AFTER="$(sqlite3 "$REAL_DB" 'select count(*) from session')"
printf 'real_db=%s\nbefore=%s\nafter=%s\nsandbox=%s\nresolved_target=probe-worker\nresult=PASS\n' "$REAL_DB" "$BEFORE" "$AFTER" "$SANDBOX" >"$EVIDENCE/isolation-and-result.txt"
test "$BEFORE" = "$AFTER"
