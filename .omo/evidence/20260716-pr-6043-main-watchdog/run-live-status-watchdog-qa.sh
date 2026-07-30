#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE="$ROOT/.omo/evidence/20260716-pr-6043-main-watchdog"
FAKE_SCRIPT="$EVIDENCE/fake-status-retry-provider.mjs"
REAL_DB="$(opencode db path 2>/dev/null | head -1)"
REAL_COUNT_BEFORE="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session;')"
TMP_ROOT="$(mktemp -d -t pr6043-status-qa.XXXXXX)"
REAL_HOME="$HOME"
FAKE_PID=""
SERVER_PID=""
SSE_PID=""

cleanup() {
  for pid in "$SSE_PID" "$SERVER_PID" "$FAKE_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

wait_for() {
  local timeout="$1" description="$2" command="$3"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if eval "$command"; then return 0; fi
    sleep 0.25
  done
  printf 'TIMEOUT: %s\n' "$description" >&2
  return 1
}

mkdir -p "$TMP_ROOT"/{home,data,config/opencode,cache,state,project,logtmp}
if [ -d "$REAL_HOME/.opencode/bin" ]; then
  mkdir -p "$TMP_ROOT/home/.opencode"
  ln -s "$REAL_HOME/.opencode/bin" "$TMP_ROOT/home/.opencode/bin"
fi

export HOME="$TMP_ROOT/home"
export OPENCODE_TEST_HOME="$TMP_ROOT/home"
export XDG_DATA_HOME="$TMP_ROOT/data"
export XDG_CONFIG_HOME="$TMP_ROOT/config"
export XDG_CACHE_HOME="$TMP_ROOT/cache"
export XDG_STATE_HOME="$TMP_ROOT/state"
export TMPDIR="$TMP_ROOT/logtmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1

FAKE_PORT="$(free_port)"
SERVER_PORT="$(free_port)"
SERVER_PASS="pr6043-status-local"
FAKE_LOG="$TMP_ROOT/fake-provider.log"
SERVER_STDOUT="$TMP_ROOT/opencode-serve.stdout"
SERVER_STDERR="$TMP_ROOT/opencode-serve.stderr"
SSE_LOG="$TMP_ROOT/events.sse"
OMO_LOG="$TMPDIR/oh-my-opencode.log"

cat > "$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${ROOT}/packages/omo-opencode/src/index.ts"],
  "model": "openai/primary",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${FAKE_PORT}/v1",
        "timeout": 180000
      },
      "models": {
        "primary": { "limit": { "context": 200000, "output": 8192 } },
        "fallback-one": { "limit": { "context": 200000, "output": 8192 } },
        "fallback-two": { "limit": { "context": 200000, "output": 8192 } }
      }
    }
  },
  "permission": { "*": "allow" }
}
JSONC

cat > "$XDG_CONFIG_HOME/opencode/oh-my-openagent.jsonc" <<'JSONC'
{
  "runtime_fallback": {
    "enabled": true,
    "timeout_seconds": 30,
    "notify_on_fallback": false,
    "max_fallback_attempts": 3
  },
  "agents": {
    "sisyphus": {
      "displayName": "sisyphus",
      "model": "openai/primary",
      "fallback_models": ["openai/fallback-one", "openai/fallback-two"]
    }
  }
}
JSONC

FAKE_PROVIDER_PORT="$FAKE_PORT" FAKE_PROVIDER_LOG="$FAKE_LOG" node "$FAKE_SCRIPT" > "$TMP_ROOT/fake.stdout" 2>&1 &
FAKE_PID=$!
wait_for 10 "fake provider readiness" "curl --max-time 2 -fsS http://127.0.0.1:${FAKE_PORT}/health >/dev/null"

OPENCODE_SERVER_PASSWORD="$SERVER_PASS" opencode serve --port "$SERVER_PORT" --hostname 127.0.0.1 >"$SERVER_STDOUT" 2>"$SERVER_STDERR" &
SERVER_PID=$!
wait_for 45 "OpenCode server readiness" "curl --max-time 2 -fsS -u opencode:${SERVER_PASS} http://127.0.0.1:${SERVER_PORT}/global/health >/dev/null"

ENC_DIR="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$TMP_ROOT/project")"
curl -sN -u "opencode:$SERVER_PASS" "http://127.0.0.1:${SERVER_PORT}/event?directory=${ENC_DIR}" > "$SSE_LOG" &
SSE_PID=$!
wait_for 10 "server.connected SSE event" "grep -q '\"type\":\"server.connected\"' '$SSE_LOG'"

SESSION_JSON="$(curl -fsS -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session?directory=${ENC_DIR}" -H 'content-type: application/json' -d '{"title":"PR 6043 status ownership QA"}')"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | jq -er '.id')"
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session/${SESSION_ID}/prompt_async?directory=${ENC_DIR}" -H 'content-type: application/json' -d '{"agent":"sisyphus","model":{"providerID":"openai","modelID":"primary"},"parts":[{"type":"text","text":"Reply exactly QA_STATUS_FALLBACK_OK"}]}')"
[ "$HTTP_CODE" = "204" ]

wait_for 20 "primary 429 response" "grep -q 'PRIMARY_429_SENT' '$FAKE_LOG'"
wait_for 20 "session.status retry event" "grep -q '\"type\":\"session.status\"' '$SSE_LOG' && grep -q '\"type\":\"retry\"' '$SSE_LOG'"
wait_for 30 "status-owned fallback request" "grep -q 'REQUEST model=fallback-one' '$FAKE_LOG'"
wait_for 20 "status-owned fallback response" "grep -q 'QA_STATUS_FALLBACK_OK' '$SSE_LOG'"
wait_for 20 "watchdog ownership transfer log" "grep -q 'first-prompt-watchdog: cancelled (fallback ownership transferred)' '$OMO_LOG'"

sleep "${STALE_WATCHDOG_WAIT_SECONDS:-100}"
[ "$(grep -c 'REQUEST model=fallback-one' "$FAKE_LOG")" = "1" ]
[ "$(grep -c 'REQUEST model=fallback-two' "$FAKE_LOG" || true)" = "0" ]

SANDBOX_DB="$XDG_DATA_HOME/opencode/opencode.db"
SANDBOX_COUNT="$(sqlite3 "$SANDBOX_DB" 'SELECT count(*) FROM session;')"
REAL_COUNT_AFTER="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session;')"
[ "$REAL_COUNT_BEFORE" = "$REAL_COUNT_AFTER" ]

sed -e "s/${SESSION_ID}/<qa-session>/g" -e "s#${TMP_ROOT}#<isolated-sandbox>#g" -e "s#${ROOT}#<worktree>#g" \
  "$OMO_LOG" | rg 'first-prompt-watchdog|session.status|runtime-fallback' > "$EVIDENCE/thirty-eighth-live-status-plugin.log" || true
sed -n 's/^data: //p' "$SSE_LOG" | jq -c 'select(.type == "server.connected" or .type == "session.status" or .type == "message.updated" or .type == "message.part.updated" or .type == "session.idle") | {type, session:(if (.properties.sessionID // .properties.info.sessionID // .properties.part.sessionID // null) then "<qa-session>" else null end), status:(.properties.status.type // null), role:(.properties.info.role // null), text:(.properties.part.text // null)}' > "$EVIDENCE/thirty-eighth-live-status-events.jsonl"
sed -e "s/${SESSION_ID}/<qa-session>/g" "$FAKE_LOG" > "$EVIDENCE/thirty-eighth-live-status-provider.txt"
printf 'source_head=%s\nreal_db_unchanged=yes\nsandbox_isolated=yes\nsandbox_session_count=%s\nprompt_http_code=%s\nsession_status_retry_observed=yes\nstatus_fallback_requests=1\nstale_watchdog_fallback_requests=0\nownership_transfer_logged=yes\n' \
  "$(git rev-parse HEAD)" "$SANDBOX_COUNT" "$HTTP_CODE" > "$EVIDENCE/thirty-eighth-live-status-isolation-receipt.txt"

printf 'PASS source_head=%s session_status_retry=yes status_fallback_once=yes stale_watchdog_fallback=no real_db_unchanged=yes\n' "$(git rev-parse HEAD)"
