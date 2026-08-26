#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
QA_DIR="$REPO_ROOT/.agents/skills/opencode-qa/scripts"
. "$QA_DIR/lib/common.sh"

HARNESS_LOG="$SCRIPT_DIR/harness.log"
FAKE_LOG="$SCRIPT_DIR/fake-llm.log"
FAKE_STDOUT="$SCRIPT_DIR/fake-llm.stdout"
SERVE_STDOUT="$SCRIPT_DIR/opencode-serve.stdout"
SERVE_STDERR="$SCRIPT_DIR/opencode-serve.stderr"
SSE_LOG="$SCRIPT_DIR/sse-session-idle.log"
HOOK_LOG="$SCRIPT_DIR/todo-continuation-hook.log"
DB_PROOF="$SCRIPT_DIR/db-proof.txt"
TODO_API="$SCRIPT_DIR/todo-api.json"
ISOLATION="$SCRIPT_DIR/isolation-receipt.txt"
CLEANUP="$SCRIPT_DIR/cleanup-receipt.txt"

FAKE_PID=""
SSE_PID=""
OQA_SERVER_PID=""

cleanup_probe() {
  local fake_status="stopped"
  local server_status="stopped"
  local sse_status="stopped"
  if [ -n "$SSE_PID" ]; then
    kill "$SSE_PID" 2>/dev/null || true
  fi
  if [ -n "$OQA_SERVER_PID" ]; then
    kill "$OQA_SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$FAKE_PID" ]; then
    kill "$FAKE_PID" 2>/dev/null || true
  fi
  sleep 0.5
  if [ -n "$SSE_PID" ] && kill -0 "$SSE_PID" 2>/dev/null; then
    kill -9 "$SSE_PID" 2>/dev/null || true
    sse_status="force-stopped"
  fi
  if [ -n "$OQA_SERVER_PID" ] && kill -0 "$OQA_SERVER_PID" 2>/dev/null; then
    kill -9 "$OQA_SERVER_PID" 2>/dev/null || true
    server_status="force-stopped"
  fi
  if [ -n "$FAKE_PID" ] && kill -0 "$FAKE_PID" 2>/dev/null; then
    kill -9 "$FAKE_PID" 2>/dev/null || true
    fake_status="force-stopped"
  fi
  printf 'fake_llm=%s opencode_serve=%s sse_probe=%s\n' \
    "$fake_status" "$server_status" "$sse_status" \
    >"$CLEANUP"
  OQA_SERVER_PID=""
  oqa_cleanup
}
trap cleanup_probe EXIT INT TERM

: >"$HARNESS_LOG"
: >"$FAKE_LOG"
: >"$FAKE_STDOUT"
: >"$SERVE_STDOUT"
: >"$SERVE_STDERR"
: >"$SSE_LOG"
: >"$HOOK_LOG"

real_db="$(oqa_db_path)"
real_before="$(sqlite3 "$real_db" 'SELECT count(*) FROM session' 2>/dev/null || printf 'unknown')"
printf 'real_db=~/.local/share/opencode/opencode.db before=%s\n' "$real_before" >"$ISOLATION"

omo_log="${TMPDIR:-/tmp}/oh-my-opencode.log"
if [ -f "$omo_log" ]; then
  omo_offset="$(wc -c <"$omo_log" 2>/dev/null | tr -d ' ')"
else
  omo_offset=0
fi

FAKE_LLM_LOG="$FAKE_LOG" bun "$SCRIPT_DIR/fake-openai.mjs" >"$FAKE_STDOUT" 2>&1 &
FAKE_PID=$!
disown "$FAKE_PID" 2>/dev/null || true

fake_port=""
deadline=$(( $(date +%s) + 15 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  fake_port="$(awk '/^START port=/{sub(/^START port=/, ""); print; exit}' "$FAKE_LOG" 2>/dev/null)"
  if [ -n "$fake_port" ]; then
    break
  fi
  if ! kill -0 "$FAKE_PID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done
if [ -z "$fake_port" ]; then
  printf 'RESULT=HARNESS_ERROR fake_server_start_failed\n' | tee -a "$HARNESS_LOG"
  exit 1
fi

oqa_mk_isolated_xdg
mkdir -p "$XDG_CONFIG_HOME/opencode"
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSON
{
  "plugin": ["file://${REPO_ROOT}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${fake_port}/v1",
        "timeout": 30000
      },
      "models": {
        "gpt-fake": {
          "tool_call": true,
          "limit": {
            "context": 200000,
            "output": 8192
          }
        }
      }
    }
  }
}
JSON

port="$(oqa_free_port)"
pass="oqa-${RANDOM}${RANDOM}"
OPENCODE_SERVER_PASSWORD="$pass" opencode serve --port "$port" --hostname 127.0.0.1 \
  >"$SERVE_STDOUT" 2>"$SERVE_STDERR" &
OQA_SERVER_PID=$!
disown "$OQA_SERVER_PID" 2>/dev/null || true
server_url="http://127.0.0.1:$port"

if ! oqa_wait_http "$server_url/global/health" "opencode:$pass" 30; then
  printf 'RESULT=HARNESS_ERROR opencode_server_start_failed\n' | tee -a "$HARNESS_LOG"
  exit 1
fi

enc_dir="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$OQA_PROJ")"
session_json="$(curl -sS -u "opencode:$pass" \
  -X POST "$server_url/session?directory=$enc_dir" \
  -H 'content-type: application/json' \
  -d '{"title":"live todo continuation hook probe"}')"
session_id="$(printf '%s' "$session_json" | jq -r '.id // .sessionID // empty')"
if [ -z "$session_id" ]; then
  printf 'RESULT=HARNESS_ERROR session_create_failed\n' | tee -a "$HARNESS_LOG"
  exit 1
fi

bash "$QA_DIR/sse-hook-probe.sh" \
  --attach "$server_url" \
  --password "$pass" \
  --directory "$OQA_PROJ" \
  --event session.idle \
  --timeout 90 \
  >"$SSE_LOG" 2>&1 &
SSE_PID=$!
disown "$SSE_PID" 2>/dev/null || true

curl -sS -u "opencode:$pass" \
  -X POST "$server_url/session/$session_id/prompt_async?directory=$enc_dir" \
  -H 'content-type: application/json' \
  -d '{"agent":"Hephaestus - Deep Agent","tools":{"question":true},"parts":[{"type":"text","text":"LIVE_TODO_CONTINUATION_PROBE: create one pending todo, then stop without completing it."}]}' \
  >"$SCRIPT_DIR/prompt-async-response.txt"

continuation_seen=no
deadline=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if grep -q 'branch=continuation' "$FAKE_LOG" 2>/dev/null; then
    continuation_seen=yes
    break
  fi
  if grep -q 'branch=no-todo-tool' "$FAKE_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

wait "$SSE_PID"
SSE_PID=""
sse_observed=no
if grep -q "PASS: observed 'session.idle'" "$SSE_LOG" 2>/dev/null; then
  sse_observed=yes
fi

curl -sS -u "opencode:$pass" \
  "$server_url/session/$session_id/todo?directory=$enc_dir" \
  >"$TODO_API"

sandbox_db="$XDG_DATA_HOME/opencode/opencode.db"
initial_question="$(sqlite3 "$sandbox_db" "
  SELECT json_extract(m.data, '\$.tools.question')
  FROM message m
  JOIN part p ON p.message_id = m.id
  WHERE m.session_id = '$session_id'
    AND json_extract(m.data, '\$.role') = 'user'
    AND json_extract(p.data, '\$.type') = 'text'
    AND json_extract(p.data, '\$.text') LIKE '%LIVE_TODO_CONTINUATION_PROBE%'
  ORDER BY m.time_created ASC
  LIMIT 1;
" 2>/dev/null)"
internal_question="$(sqlite3 "$sandbox_db" "
  SELECT json_extract(m.data, '\$.tools.question')
  FROM message m
  JOIN part p ON p.message_id = m.id
  WHERE m.session_id = '$session_id'
    AND json_extract(m.data, '\$.role') = 'user'
    AND json_extract(p.data, '\$.type') = 'text'
    AND json_extract(p.data, '\$.text') LIKE '%Incomplete tasks remain in your todo list%'
  ORDER BY m.time_created ASC
  LIMIT 1;
" 2>/dev/null)"
internal_count="$(sqlite3 "$sandbox_db" "
  SELECT count(*)
  FROM message m
  JOIN part p ON p.message_id = m.id
  WHERE m.session_id = '$session_id'
    AND json_extract(m.data, '\$.role') = 'user'
    AND json_extract(p.data, '\$.type') = 'text'
    AND json_extract(p.data, '\$.text') LIKE '%Incomplete tasks remain in your todo list%';
" 2>/dev/null)"
pending_todos="$(jq '[.[] | select(.status != "completed" and .status != "cancelled")] | length' "$TODO_API" 2>/dev/null)"

printf 'initial_user_tools.question=%s\n' "${initial_question:-missing}" >"$DB_PROOF"
printf 'internal_continuation_tools.question=%s\n' "${internal_question:-missing}" >>"$DB_PROOF"
printf 'internal_continuation_messages=%s\n' "${internal_count:-0}" >>"$DB_PROOF"
printf 'pending_todos=%s\n' "${pending_todos:-0}" >>"$DB_PROOF"

if [ -f "$omo_log" ]; then
  tail -c "+$((omo_offset + 1))" "$omo_log" 2>/dev/null \
    | grep 'todo-continuation-enforcer\|prompt-async-gate' \
    | grep "$session_id" \
    | sed "s/$session_id/<sandbox-session>/g" \
    >"$HOOK_LOG" || true
fi

real_after="$(sqlite3 "$real_db" 'SELECT count(*) FROM session' 2>/dev/null || printf 'unknown')"
unchanged=no
if [ "$real_before" = "$real_after" ]; then
  unchanged=yes
fi
printf 'after=%s unchanged=%s\n' "$real_after" "$unchanged" >>"$ISOLATION"
printf 'sandbox_session=<redacted>\n' >>"$ISOLATION"

hook_success=no
if grep -q 'Injection successful' "$HOOK_LOG" 2>/dev/null; then
  hook_success=yes
fi

question_removed=no
if [ "$internal_question" = "0" ] || [ "$internal_question" = "false" ]; then
  question_removed=yes
fi

if [ "$continuation_seen" = yes ] \
  && [ "${internal_count:-0}" -ge 1 ] \
  && [ "${pending_todos:-0}" -ge 1 ] \
  && [ "$question_removed" = yes ] \
  && [ "$sse_observed" = yes ] \
  && [ "$hook_success" = yes ] \
  && [ "$unchanged" = yes ]; then
  printf 'RESULT=PASS continuation_seen=yes internal_question=%s pending_todos=%s sse_session_idle=observed hook_injection=successful isolation=unchanged\n' \
    "$internal_question" "$pending_todos" | tee -a "$HARNESS_LOG"
  exit 0
fi

printf 'RESULT=FAIL continuation_seen=%s initial_question=%s internal_question=%s internal_count=%s pending_todos=%s sse_status=%s hook_success=%s isolation=%s\n' \
  "$continuation_seen" "${initial_question:-missing}" "${internal_question:-missing}" "${internal_count:-0}" \
  "${pending_todos:-0}" "$sse_observed" "$hook_success" "$unchanged" | tee -a "$HARNESS_LOG"
exit 1
