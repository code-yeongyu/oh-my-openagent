#!/usr/bin/env bash
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
evidence="$repo/.omo/evidence/20260809-model-chain-consistency"
. "$repo/.agents/skills/opencode-qa/scripts/lib/common.sh"
set -euo pipefail

oqa_require opencode sqlite3 curl jq bun
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
  "model": "qa/gpt-5.6-sol-primary",
  "small_model": "qa/title",
  "provider": {
    "qa": {
      "name": "QA OpenAI",
      "npm": "@ai-sdk/openai",
      "env": [],
      "options": { "apiKey": "qa-key", "baseURL": "http://127.0.0.1:$fake_port/v1" },
      "models": {
        "title": { "name": "QA Title", "tool_call": true, "limit": { "context": 128000, "output": 4096 } },
        "gpt-5.6-sol-primary": { "name": "QA Primary", "tool_call": true, "limit": { "context": 128000, "output": 4096 } },
        "gpt-5.6-sol": { "name": "QA Fallback", "reasoning": true, "tool_call": true, "limit": { "context": 128000, "output": 4096 } }
      }
    }
  },
  "permission": "allow"
}
EOF

cat >"$OQA_PROJ/.omo/omo.jsonc" <<'EOF'
{
  "[opencode]": {
    "model_fallback": true,
    "runtime_fallback": { "enabled": false },
    "agents": {
      "explore": {
        "models": [
          "qa/gpt-5.6-sol-primary",
          { "model": "qa/gpt-5.6-sol", "reasoning": "high" }
        ]
      }
    }
  }
}
EOF

QA_FAKE_PORT="$fake_port" QA_FAKE_LOG="$qa/provider.jsonl" \
  bun "$evidence/qa-fake-openai.mjs" >"$qa/fake.log" 2>&1 &
fake_pid=$!
OQA_CURL_PIDS+=("$fake_pid")
oqa_wait_http "http://127.0.0.1:$fake_port/health" "" 30 || { cat "$qa/fake.log" >&2; exit 1; }

export OPENCODE_CONFIG_DIR="$qa/config/opencode"
QA_OBSERVER_LOG="$qa/observer.jsonl" \
  opencode serve --hostname 127.0.0.1 --port "$server_port" >"$qa/server.log" 2>&1 &
OQA_SERVER_PID=$!
base="http://127.0.0.1:$server_port"
oqa_wait_http "$base/global/health" "" 30 || { cat "$qa/server.log" >&2; exit 1; }

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
wait "$sse_pid"

curl -fsS -X POST -H 'Content-Type: application/json' \
  -H "x-opencode-directory: $OQA_PROJ" \
  -d '{"agent":"explore","parts":[{"type":"text","text":"SECOND_EXACT: reply briefly"}]}' \
  "$base/session/$session_id/message" >"$qa/turn2.json"
jq -e '.info.modelID == "gpt-5.6-sol"' >/dev/null "$qa/turn2.json"

curl -fsS -X POST -H 'Content-Type: application/json' \
  -H "x-opencode-directory: $OQA_PROJ" \
  -d '{"agent":"explore","model":{"providerID":"qa","modelID":"gpt-5.6-sol"},"parts":[{"type":"text","text":"THIRD_EXACT: reply briefly"}]}' \
  "$base/session/$session_id/message" >"$qa/turn3.json"
jq -e '.info.modelID == "gpt-5.6-sol"' >/dev/null "$qa/turn3.json"

provider_models="$(jq -sc 'map(.model)' "$qa/provider.jsonl")"
jq -se 'any(.[]; .model == "gpt-5.6-sol" and .reasoning.effort == "high")' >/dev/null "$qa/provider.jsonl"
jq -se 'last | .model == "gpt-5.6-sol" and .reasoning.effort == "medium"' >/dev/null "$qa/provider.jsonl"
jq -se --arg id "$session_id" '
  [ .[] | select(.type == "chat.params" and .input.sessionID == $id) ] as $calls
  | any($calls[]; .output.options.reasoningEffort == "high")
    and ($calls | last | .output.options.reasoningEffort == "medium")
' >/dev/null "$qa/observer.jsonl"

curl -fsS -X DELETE -H "x-opencode-directory: $OQA_PROJ" "$base/session/$session_id" >/dev/null
isolated_db="$XDG_DATA_HOME/opencode/opencode.db"
isolated_after="$(sqlite3 "$isolated_db" 'SELECT count(*) FROM session;')"
live_id_matches="$(sqlite3 "$live_db" "SELECT count(*) FROM session WHERE id='$session_id';")"
test "$isolated_after" = "0"
test "$live_id_matches" = "0"

printf 'OpenCode: %s\n' "$(opencode --version)"
printf 'session: %s\n' "$session_id"
printf 'provider models: %s\n' "$provider_models"
printf 'fallback request reasoning: %s\n' "$(jq -scr '[.[] | select(.model == "gpt-5.6-sol" and .reasoning.effort == "high")][0].reasoning.effort' "$qa/provider.jsonl")"
printf 'same-model request reasoning: %s\n' "$(jq -scr 'last | .reasoning.effort // "none"' "$qa/provider.jsonl")"
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
printf 'PASS: proactive fallback variant cleared on the same model\n'
