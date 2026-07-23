#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE="$ROOT/.omo/evidence/20260717-pr-6043-post-fetch-terminal-repair"
ASSET_EVIDENCE="$ROOT/.omo/evidence/20260717-pr-6043-final-round13"
SOURCE_PATHS=(
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-generation-race.test.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-message-fetch-ordering.test.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-ownership.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-terminal-races.test.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts
  packages/omo-opencode/src/hooks/runtime-fallback/hook.ts
  packages/omo-opencode/src/hooks/runtime-fallback/watchdog-abort-provenance.ts
)
RUNTIME_SOURCE_PARENT="c71b41c1574a191a51c7497da43c11d5d2aa9d0e"
RUNTIME_SOURCE_HEAD="0dd0ab901c8ddc1a49155efddad7aea982c9a458"
FAKE_SCRIPT="$ASSET_EVIDENCE/fake-silent-provider.mjs"
ROOT_PROBE="$ASSET_EVIDENCE/root-state-probe.ts"
REAL_DB="$(opencode db path 2>/dev/null | head -1)"
REAL_COUNT_BEFORE="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session;')"
TMP_ROOT="$(mktemp -d -t pr6043-live-qa.XXXXXX)"
REAL_HOME="$HOME"
FAKE_PID=""
SERVER_PID=""
SSE_PID=""
FAKE_LOG=""
SERVER_STDOUT=""
SERVER_STDERR=""
SSE_LOG=""
ROOT_PROBE_LOG=""
OMO_LOG="${TMPDIR:-/tmp}/oh-my-opencode.log"
OMO_OFFSET=0
RUN_SUCCEEDED=0

RUN_HEAD="$(git rev-parse HEAD)"
test -z "$(git status --porcelain=v1)"
git merge-base --is-ancestor "$RUNTIME_SOURCE_HEAD" "$RUN_HEAD"
test "$(git rev-parse "${RUNTIME_SOURCE_HEAD}^")" = "$RUNTIME_SOURCE_PARENT"
SOURCE_DIFF_SHA256="$(git diff "$RUNTIME_SOURCE_PARENT" "$RUNTIME_SOURCE_HEAD" -- "${SOURCE_PATHS[@]}" | shasum -a 256 | awk '{print $1}')"
[ "$SOURCE_DIFF_SHA256" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]
SOURCE_MATCHES=committed-runtime-source

cleanup() {
  if [ "$RUN_SUCCEEDED" = 0 ]; then
    [ -n "$FAKE_LOG" ] && [ -f "$FAKE_LOG" ] && cp "$FAKE_LOG" "$EVIDENCE/live-last-fake-provider.txt" || true
    [ -n "$SERVER_STDOUT" ] && [ -f "$SERVER_STDOUT" ] && cp "$SERVER_STDOUT" "$EVIDENCE/live-last-server.stdout" || true
    [ -n "$SERVER_STDERR" ] && [ -f "$SERVER_STDERR" ] && cp "$SERVER_STDERR" "$EVIDENCE/live-last-server.stderr" || true
    [ -n "$SSE_LOG" ] && [ -f "$SSE_LOG" ] && cp "$SSE_LOG" "$EVIDENCE/live-last-events.sse" || true
    [ -n "$ROOT_PROBE_LOG" ] && [ -f "$ROOT_PROBE_LOG" ] && cp "$ROOT_PROBE_LOG" "$EVIDENCE/live-last-root-state.jsonl" || true
    if [ -f "$OMO_LOG" ]; then
      tail -c "+$((OMO_OFFSET + 1))" "$OMO_LOG" | rg 'first-prompt-watchdog|runtime-fallback|ENTRY - plugin loading|Config loaded' > "$EVIDENCE/live-last-plugin.log" || true
    fi
  fi
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

rm -f "$EVIDENCE"/live-last-*

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
OMO_LOG="$TMPDIR/oh-my-opencode.log"

FAKE_PORT="$(free_port)"
SERVER_PORT="$(free_port)"
SERVER_PASS="pr6043-qa-local"
FAKE_LOG="$TMP_ROOT/fake-provider.log"
SERVER_STDOUT="$TMP_ROOT/opencode-serve.stdout"
SERVER_STDERR="$TMP_ROOT/opencode-serve.stderr"
SSE_LOG="$TMP_ROOT/events.sse"
ROOT_PROBE_LOG="$TMP_ROOT/root-state.jsonl"
[ -f "$OMO_LOG" ] && OMO_OFFSET="$(wc -c < "$OMO_LOG" | tr -d ' ')"

cat > "$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSONC
{
  "plugin": [
    "file://${ROOT}/packages/omo-opencode/src/index.ts",
    "file://${ROOT_PROBE}"
  ],
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
        "fallback": { "limit": { "context": 200000, "output": 8192 } }
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
    "max_fallback_attempts": 2
  },
  "agents": {
    "sisyphus": {
      "displayName": "sisyphus",
      "model": "openai/primary",
      "fallback_models": ["openai/fallback"]
    }
  }
}
JSONC

FAKE_PROVIDER_PORT="$FAKE_PORT" FAKE_PROVIDER_LOG="$FAKE_LOG" node "$FAKE_SCRIPT" > "$TMP_ROOT/fake.stdout" 2>&1 &
FAKE_PID=$!
wait_for 10 "fake provider readiness" "curl --max-time 2 -fsS http://127.0.0.1:${FAKE_PORT}/health >/dev/null"

PR6043_ROOT_PROBE_LOG="$ROOT_PROBE_LOG" OPENCODE_SERVER_PASSWORD="$SERVER_PASS" opencode serve --port "$SERVER_PORT" --hostname 127.0.0.1 >"$SERVER_STDOUT" 2>"$SERVER_STDERR" &
SERVER_PID=$!
wait_for 45 "OpenCode server readiness" "curl --max-time 2 -fsS -u opencode:${SERVER_PASS} http://127.0.0.1:${SERVER_PORT}/global/health >/dev/null"

ENC_DIR="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$TMP_ROOT/project")"
curl -sN -u "opencode:$SERVER_PASS" "http://127.0.0.1:${SERVER_PORT}/event?directory=${ENC_DIR}" > "$SSE_LOG" &
SSE_PID=$!
wait_for 10 "server.connected SSE event" "grep -q '\"type\":\"server.connected\"' '$SSE_LOG'"

OLDER_SESSION_JSON="$(curl -fsS -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session?directory=${ENC_DIR}" -H 'content-type: application/json' -d '{"title":"PR 6043 older root watchdog QA"}')"
OLDER_SESSION_ID="$(printf '%s' "$OLDER_SESSION_JSON" | jq -er '.id')"
NEWER_SESSION_JSON="$(curl -fsS -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session?directory=${ENC_DIR}" -H 'content-type: application/json' -d '{"title":"PR 6043 newer root lifecycle QA"}')"
NEWER_SESSION_ID="$(printf '%s' "$NEWER_SESSION_JSON" | jq -er '.id')"
wait_for 10 "two active roots in plugin state" "jq -e --arg older '$OLDER_SESSION_ID' --arg newer '$NEWER_SESSION_ID' 'select(.type == \"session.created\" and .eventSessionID == \$newer and .currentSessionID == \$newer and ([.roots[] | select(.id == \$older and .active == true)] | length) == 1 and ([.roots[] | select(.id == \$newer and .active == true)] | length) == 1)' '$ROOT_PROBE_LOG' >/dev/null"
SESSION_ID="$OLDER_SESSION_ID"

HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session/${SESSION_ID}/prompt_async?directory=${ENC_DIR}" -H 'content-type: application/json' -d '{"agent":"sisyphus","model":{"providerID":"openai","modelID":"primary"},"parts":[{"type":"text","text":"Reply exactly QA_FALLBACK_OK"}]}')"
[ "$HTTP_CODE" = "204" ]

wait_for 15 "primary provider request" "grep -q 'REQUEST model=primary' '$FAKE_LOG'"
if grep -q '\"type\":\"session.error\"' "$SSE_LOG"; then
  printf 'EARLY session.error before watchdog deadline\n' >&2
  exit 1
fi
wait_for "${WATCHDOG_WAIT_SECONDS:-125}" "watchdog fallback request" "grep -q 'REQUEST model=fallback' '$FAKE_LOG'"
wait_for 20 "fallback response SSE" "grep -q 'QA_FALLBACK_OK' '$SSE_LOG'"
wait_for 20 "primary request abort" "grep -q 'PRIMARY_CONNECTION_CLOSED' '$FAKE_LOG'"
wait_for 20 "plugin fallback completion bookkeeping" "grep -q 'Assistant response observed; cleared fallback timeout' '$OMO_LOG'"

if [ -f "$OMO_LOG" ]; then
  ARM_COUNT_AFTER_SUCCESS="$(tail -c "+$((OMO_OFFSET + 1))" "$OMO_LOG" | grep -c 'first-prompt-watchdog: armed' || true)"
  sleep 1
  ARM_COUNT_AFTER_SETTLE="$(tail -c "+$((OMO_OFFSET + 1))" "$OMO_LOG" | grep -c 'first-prompt-watchdog: armed' || true)"
  [ "$ARM_COUNT_AFTER_SUCCESS" = "$ARM_COUNT_AFTER_SETTLE" ]
else
  ARM_COUNT_AFTER_SUCCESS=0
  ARM_COUNT_AFTER_SETTLE=0
fi
[ "$(grep -c 'REQUEST model=fallback' "$FAKE_LOG")" = "1" ]

DELETE_HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -u "opencode:$SERVER_PASS" -X DELETE "http://127.0.0.1:${SERVER_PORT}/session/${NEWER_SESSION_ID}?directory=${ENC_DIR}")"
[ "$DELETE_HTTP_CODE" = "200" ]
wait_for 10 "older root restored after newer root deletion" "jq -e --arg older '$OLDER_SESSION_ID' --arg newer '$NEWER_SESSION_ID' 'select(.type == \"session.deleted\" and .eventSessionID == \$newer and .currentSessionID == \$older and ([.roots[] | select(.id == \$older and .active == true)] | length) == 1 and ([.roots[] | select(.id == \$newer and .active == false)] | length) == 1)' '$ROOT_PROBE_LOG' >/dev/null"

SECOND_HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session/${SESSION_ID}/prompt_async?directory=${ENC_DIR}" -H 'content-type: application/json' -d '{"agent":"sisyphus","model":{"providerID":"openai","modelID":"fallback"},"parts":[{"type":"text","text":"Second turn for user cancellation QA"}]}')"
[ "$SECOND_HTTP_CODE" = "204" ]
wait_for 20 "second user turn reaches fallback provider" "grep -q 'FALLBACK_HANGING_FOR_USER_ABORT' '$FAKE_LOG'"
ABORT_HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -u "opencode:$SERVER_PASS" -X POST "http://127.0.0.1:${SERVER_PORT}/session/${SESSION_ID}/abort?directory=${ENC_DIR}")"
[ "$ABORT_HTTP_CODE" = "200" ]

if [ -f "$OMO_LOG" ]; then
  wait_for 15 "watchdog dispatch log" "grep -q 'first-prompt-watchdog.*dispatching fallback' '$OMO_LOG'"
  wait_for 15 "watchdog abort log" "grep -q 'Aborted in-flight session request (first-prompt-watchdog)' '$OMO_LOG'"
  wait_for 15 "later user abort classified as cancellation" "grep -q 'session.error matched cancellation; cleared retry state' '$OMO_LOG'"
  tail -c "+$((OMO_OFFSET + 1))" "$OMO_LOG" | rg "${SESSION_ID}|first-prompt-watchdog" > "$TMP_ROOT/plugin-watchdog.log" || true
else
  : > "$TMP_ROOT/plugin-watchdog.log"
fi

grep -q 'first-prompt-watchdog.*dispatching fallback' "$TMP_ROOT/plugin-watchdog.log"
grep -q 'Aborted in-flight session request (first-prompt-watchdog)' "$TMP_ROOT/plugin-watchdog.log"
grep -q 'session.error matched cancellation; cleared retry state' "$TMP_ROOT/plugin-watchdog.log"

SANDBOX_DB="$XDG_DATA_HOME/opencode/opencode.db"
SANDBOX_COUNT="$(sqlite3 "$SANDBOX_DB" 'SELECT count(*) FROM session;')"
REAL_COUNT_AFTER="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session;')"
[ "$REAL_COUNT_BEFORE" = "$REAL_COUNT_AFTER" ]

cp "$FAKE_LOG" "$EVIDENCE/live-fake-provider.txt"
sed -e "s/${SESSION_ID}/<qa-session>/g" -e "s#${TMP_ROOT}#<isolated-sandbox>#g" -e "s#${ROOT}#<worktree>#g" \
  "$TMP_ROOT/plugin-watchdog.log" > "$EVIDENCE/live-plugin-watchdog.txt"
sed -n 's/^data: //p' "$SSE_LOG" | jq -c 'select(.type == "server.connected" or .type == "session.created" or .type == "session.deleted" or .type == "message.updated" or .type == "message.part.updated" or .type == "message.part.delta" or .type == "session.error" or .type == "session.idle") | {type, session:(if (.properties.sessionID // .properties.info.sessionID // .properties.info.id // .properties.part.sessionID // null) then "<qa-session>" else null end), role:(.properties.info.role // null), text:(.properties.part.text // .properties.delta // null)}' > "$EVIDENCE/live-sse-events.jsonl"
sed -e "s/${OLDER_SESSION_ID}/<older-root>/g" -e "s/${NEWER_SESSION_ID}/<newer-root>/g" "$ROOT_PROBE_LOG" > "$EVIDENCE/live-root-state.jsonl"
printf 'run_head=%s\nruntime_source_head=%s\nruntime_source_parent=%s\nsource_diff_sha256=%s\nsource_matches=%s\nreal_db_unchanged=yes\nsandbox_isolated=yes\nsandbox_session_count=%s\nprompt_http_code=%s\nsecond_prompt_http_code=%s\nuser_abort_http_code=%s\nnewer_root_delete_http_code=%s\nolder_root_watchdog_fallback=yes\ntwo_active_roots_observed=yes\nolder_root_restored_after_delete=yes\nprimary_requests=%s\nfallback_requests=%s\nprimary_connection_closed=%s\nfallback_response_seen=%s\nfallback_watchdog_rearmed=no\nwatchdog_arm_count_after_success=%s\nwatchdog_arm_count_after_settle=%s\nuser_abort_classified_external=yes\n' \
  "$RUN_HEAD" "$RUNTIME_SOURCE_HEAD" "$RUNTIME_SOURCE_PARENT" "$SOURCE_DIFF_SHA256" "$SOURCE_MATCHES" \
  "$SANDBOX_COUNT" "$HTTP_CODE" "$SECOND_HTTP_CODE" "$ABORT_HTTP_CODE" "$DELETE_HTTP_CODE" \
  "$(grep -c 'REQUEST model=primary' "$FAKE_LOG")" "$(grep -c 'REQUEST model=fallback' "$FAKE_LOG")" \
  "$(grep -c 'PRIMARY_CONNECTION_CLOSED' "$FAKE_LOG")" "$(grep -c 'QA_FALLBACK_OK' "$SSE_LOG")" \
  "$ARM_COUNT_AFTER_SUCCESS" "$ARM_COUNT_AFTER_SETTLE" \
  > "$EVIDENCE/live-isolation-receipt.txt"

RUN_SUCCEEDED=1
printf 'PASS run_head=%s runtime_source_head=%s source_diff_sha256=%s source_matches=%s real_db_unchanged=yes older_root_fallback=yes two_active_roots=yes deletion_restored_older=yes fallback_watchdog_rearmed=no later_user_abort=external\n' \
  "$RUN_HEAD" "$RUNTIME_SOURCE_HEAD" "$SOURCE_DIFF_SHA256" "$SOURCE_MATCHES"
