#!/usr/bin/env bash
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
evidence="$repo/.omo/evidence/20260809-model-chain-consistency"
. "$repo/.agents/skills/opencode-qa/scripts/lib/common.sh"
set -euo pipefail

oqa_require opencode sqlite3 curl jq bun
wait_http() {
  for _ in {1..300}; do
    curl -fs --max-time 1 -o /dev/null "$1" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}
live_db="$(oqa_db_path)"
live_before="$(sqlite3 "$live_db" 'SELECT count(*) FROM session;')"

oqa_mk_isolated_xdg
qa="$OQA_XDG_ROOT"
mkdir -p "$qa/config/opencode" "$OQA_PROJ/.omo"
ln -s "$repo/node_modules" "$qa/config/opencode/node_modules"
fake_port="$(oqa_free_port)"
server_port="$(oqa_free_port)"

cat >"$qa/config/opencode/opencode.jsonc" <<EOF
{
  "plugin": [
    "file://$repo/packages/omo-opencode/src/index.ts",
    "file://$evidence/qa-observer-plugin.ts"
  ],
  "model": "qa/primary",
  "small_model": "qa/fallback",
  "provider": {
    "qa": {
      "name": "QA OpenAI",
      "npm": "@ai-sdk/openai",
      "env": [],
      "options": { "apiKey": "qa-key", "baseURL": "http://127.0.0.1:$fake_port/v1" },
      "models": {
        "primary": { "name": "QA Primary", "tool_call": true, "limit": { "context": 128000, "output": 4096 } },
        "fallback": { "name": "QA Fallback", "tool_call": true, "limit": { "context": 128000, "output": 4096 } }
      }
    }
  },
  "permission": "allow"
}
EOF

cat >"$OQA_PROJ/.omo/omo.jsonc" <<'EOF'
{
  "[opencode]": {
    "model_fallback": false,
    "runtime_fallback": {
      "enabled": true,
      "notify_on_fallback": false,
      "timeout_seconds": 5,
      "cooldown_seconds": 0,
      "restore_primary_after_cooldown": true
    },
    "agents": { "explore": { "models": ["qa/primary", "qa/fallback"] } }
  }
}
EOF

QA_FAKE_PORT="$fake_port" QA_FAKE_LOG="$qa/provider.jsonl" QA_FAIL_PRIMARY_ONCE=1 \
  bun "$evidence/qa-fake-openai.mjs" >"$qa/fake.log" 2>&1 &
fake_pid=$!
OQA_CURL_PIDS+=("$fake_pid")
wait_http "http://127.0.0.1:$fake_port/health" || { cat "$qa/fake.log" >&2; exit 1; }

export OPENCODE_CONFIG_DIR="$qa/config/opencode"
QA_OBSERVER_LOG="$qa/observer.jsonl" \
  opencode serve --hostname 127.0.0.1 --port "$server_port" >"$qa/server.log" 2>&1 &
OQA_SERVER_PID=$!
base="http://127.0.0.1:$server_port"
wait_http "$base/global/health" || { cat "$qa/server.log" >&2; exit 1; }

session="$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -H "x-opencode-directory: $OQA_PROJ" -d '{}' "$base/session")"
session_id="$(jq -r '.id' <<<"$session")"

bash "$repo/.agents/skills/opencode-qa/scripts/sse-hook-probe.sh" \
  --attach "$base" --directory "$OQA_PROJ" --event session.status --timeout 60 \
  >"$qa/sse.txt" 2>&1 &
sse_pid=$!
OQA_CURL_PIDS+=("$sse_pid")

curl -fsS -X POST -H 'Content-Type: application/json' \
  -H "x-opencode-directory: $OQA_PROJ" \
  -d '{"agent":"explore","parts":[{"type":"text","text":"FIRST_EXACT: reply briefly"}]}' \
  "$base/session/$session_id/message" >"$qa/turn1.json"

for _ in {1..100}; do
  messages="$(curl -fsS -H "x-opencode-directory: $OQA_PROJ" "$base/session/$session_id/message")"
  jq -e 'any(.[]; .info.role == "assistant" and .info.modelID == "fallback" and any(.parts[]?; .text == "REAL_OPENCODE_FALLBACK_OK"))' \
    >/dev/null <<<"$messages" && break
  sleep 0.1
done
jq -e 'any(.[]; .info.role == "assistant" and .info.modelID == "fallback" and any(.parts[]?; .text == "REAL_OPENCODE_FALLBACK_OK"))' \
  >/dev/null <<<"$messages"
wait "$sse_pid"

curl -fsS -X POST -H 'Content-Type: application/json' \
  -H "x-opencode-directory: $OQA_PROJ" \
  -d '{"agent":"build","model":{"providerID":"qa","modelID":"fallback"},"parts":[{"type":"text","text":"SECOND_EXACT: reply briefly"}]}' \
  "$base/session/$session_id/message" >"$qa/turn2.json"
isolated_db="$XDG_DATA_HOME/opencode/opencode.db"
persisted_second="$(sqlite3 "$isolated_db" "SELECT json_extract(model, '$.id') FROM session WHERE id='$session_id';")"
test "$persisted_second" = "fallback"
jq -e '.info.modelID == "primary"' >/dev/null "$qa/turn2.json"

curl -fsS -X POST -H 'Content-Type: application/json' \
  -H "x-opencode-directory: $OQA_PROJ" \
  -d '{"agent":"build","parts":[{"type":"text","text":"THIRD_EXACT: reply briefly"}]}' \
  "$base/session/$session_id/message" >"$qa/turn3.json"
persisted_third="$(sqlite3 "$isolated_db" "SELECT json_extract(model, '$.id') FROM session WHERE id='$session_id';")"
test "$persisted_third" = "fallback"
jq -e '.info.modelID == "primary"' >/dev/null "$qa/turn3.json"

provider_models="$(jq -sc 'map(.model)' "$qa/provider.jsonl")"
test "$provider_models" = '["fallback","primary","fallback","primary","primary"]'
jq -se --arg id "$session_id" '
  [ .[] | select(.type == "chat.message" and .input.sessionID == $id) ] as $calls
  | any($calls[]; .input.agent == "build" and .input.model.modelID == "fallback" and .output.message.model.modelID == "primary")
    and any($calls[]; .input.agent == "build" and (.input | has("model") | not) and .output.message.model.modelID == "primary")
' >/dev/null "$qa/observer.jsonl"

curl -fsS -X DELETE -H "x-opencode-directory: $OQA_PROJ" "$base/session/$session_id" >/dev/null
isolated_after="$(sqlite3 "$isolated_db" 'SELECT count(*) FROM session;')"
live_id_matches="$(sqlite3 "$live_db" "SELECT count(*) FROM session WHERE id='$session_id';")"
test "$isolated_after" = "0"
test "$live_id_matches" = "0"

printf 'OpenCode: %s\n' "$(opencode --version)"
printf 'session: %s\n' "$session_id"
printf 'provider models: %s\n' "$provider_models"
printf 'persisted model after cooldown restore: %s\n' "$persisted_second"
printf 'persisted model before omitted-model prompt: %s\n' "$persisted_third"
printf 'turn 2 output model: %s\n' "$(jq -r '.info.providerID + "/" + .info.modelID' "$qa/turn2.json")"
printf 'turn 3 output model: %s\n' "$(jq -r '.info.providerID + "/" + .info.modelID' "$qa/turn3.json")"
cat "$qa/sse.txt"
printf 'isolated session count after delete: %s\n' "$isolated_after"
printf 'live session ID matches: %s\n' "$live_id_matches"

oqa_cleanup
test -z "$(lsof -nP -iTCP:"$fake_port" -sTCP:LISTEN -t 2>/dev/null || true)"
test -z "$(lsof -nP -iTCP:"$server_port" -sTCP:LISTEN -t 2>/dev/null || true)"
live_after="$(sqlite3 "$live_db" 'SELECT count(*) FROM session;')"
test "$live_before" = "$live_after"
printf 'live session count: %s -> %s\n' "$live_before" "$live_after"
printf 'ports stopped: %s, %s\n' "$fake_port" "$server_port"
printf 'PASS: real cooldown restoration survived stale persisted fallback\n'
