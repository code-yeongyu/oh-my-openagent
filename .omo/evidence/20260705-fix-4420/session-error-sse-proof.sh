#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
QA_COMMON="$REPO_ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"

. "$QA_COMMON"

PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

log_file="$SCRIPT_DIR/session-error-sse-proof.txt"
serve_stdout="$SCRIPT_DIR/session-error-opencode-serve.stdout"
serve_stderr="$SCRIPT_DIR/session-error-opencode-serve.stderr"
sse_stream="$SCRIPT_DIR/session-error-sse-stream.ndjson"
failing_stdout="$SCRIPT_DIR/session-error-failing-provider.stdout"
failing_stderr="$SCRIPT_DIR/session-error-failing-provider.stderr"

: >"$log_file"
: >"$sse_stream"

proof_log() {
  printf '%s\n' "$*" | tee -a "$log_file"
}

urlencode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

wait_for_pattern() {
  local file="$1" pattern="$2" timeout="$3"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if grep -q "$pattern" "$file" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

failing_port="$(oqa_free_port)"
FAILING_OPENAI_PORT="$failing_port" bun run "$SCRIPT_DIR/failing-openai-429.mjs" >"$failing_stdout" 2>"$failing_stderr" &
failing_pid=$!
OQA_CURL_PIDS+=("$failing_pid")
disown "$failing_pid" 2>/dev/null || true

if ! wait_for_pattern "$failing_stdout" "failing-openai listening on" 10; then
  proof_log "FAIL: failing provider did not start"
  exit 1
fi
proof_log "failing_provider_port=$failing_port"

real_db_path="$(opencode db path 2>/dev/null | head -1 || true)"
real_db_before="0"
if [ -n "$real_db_path" ] && [ -f "$real_db_path" ]; then
  real_db_before="$(sqlite3 "$real_db_path" 'SELECT count(*) FROM session' 2>/dev/null || echo "0")"
fi
proof_log "real_db_before=$real_db_before path=$real_db_path"

oqa_mk_isolated_xdg
proof_log "sandbox=$OQA_XDG_ROOT"
mkdir -p "$XDG_CONFIG_HOME/opencode"
cat >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json" <<JSON
{
  "disabled_hooks": ["startup-toast", "legacy-plugin-toast"]
}
JSON
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${REPO_ROOT}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fail",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${failing_port}/v1",
        "timeout": 5000
      },
      "models": {
        "gpt-fail": {
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
JSONC

server_port="$(oqa_free_port)"
server_pass="oqa-${RANDOM}${RANDOM}"
OPENCODE_SERVER_PASSWORD="$server_pass" opencode serve --port "$server_port" --hostname 127.0.0.1 >"$serve_stdout" 2>"$serve_stderr" &
OQA_SERVER_PID=$!
disown "$OQA_SERVER_PID" 2>/dev/null || true
server_url="http://127.0.0.1:$server_port"

if ! oqa_wait_http "$server_url/global/health" "opencode:$server_pass" 30; then
  proof_log "FAIL: opencode serve did not become healthy"
  exit 1
fi
proof_log "server_url=$server_url"

if ! wait_for_pattern "$serve_stdout" "opencode server listening" 10; then
  proof_log "FAIL: opencode serve did not print listening banner"
  exit 1
fi

if ! curl -sS -u "opencode:$server_pass" "$server_url/doc" >/dev/null; then
  proof_log "FAIL: opencode /doc was not readable"
  exit 1
fi
proof_log "server_doc_ready=true"

encoded_dir="$(urlencode "$OQA_PROJ")"
session_response="$(curl -sS -u "opencode:$server_pass" -X POST "$server_url/session?directory=$encoded_dir" -H 'content-type: application/json' -d '{"title":"session.error SSE proof"}')"
session_id="$(printf '%s' "$session_response" | jq -r '.id // .sessionID // empty')"
if [ -z "$session_id" ]; then
  proof_log "FAIL: session create failed response=$session_response"
  exit 1
fi
proof_log "session_id=$session_id"

curl -sN -u "opencode:$server_pass" "$server_url/event?directory=$encoded_dir" >"$sse_stream" 2>>"$log_file" &
sse_pid=$!
OQA_CURL_PIDS+=("$sse_pid")
disown "$sse_pid" 2>/dev/null || true

if ! wait_for_pattern "$sse_stream" '"server.connected"' 10; then
  proof_log "FAIL: SSE stream did not connect"
  exit 1
fi
proof_log "sse_connected=true"

sleep 2
proof_log "post_connect_settle_ms=2000"

prompt_status="$(curl -sS -o /dev/null -w '%{http_code}' -u "opencode:$server_pass" \
  -X POST "$server_url/session/$session_id/prompt_async?directory=$encoded_dir" \
  -H 'content-type: application/json' \
  -d '{"parts":[{"type":"text","text":"trigger provider quota error"}]}')"
proof_log "prompt_async_http_status=$prompt_status"

if ! wait_for_pattern "$sse_stream" '"session.error"' 25; then
  proof_log "FAIL: session.error not observed"
  head -20 "$sse_stream" >>"$log_file"
  exit 1
fi

first_error="$(grep -m1 '"session.error"' "$sse_stream" | sed 's/^data: //')"
printf '%s\n' "$first_error" >"$SCRIPT_DIR/session-error-event.json"
proof_log "observed_session_error=$(printf '%s' "$first_error" | jq -c '{type: .type, hasSession: (.properties.sessionID != null or .properties.sessionId != null), error: .properties.error}' 2>/dev/null || printf '%s' "$first_error")"

real_db_after="$real_db_before"
if [ -n "$real_db_path" ] && [ -f "$real_db_path" ]; then
  real_db_after="$(sqlite3 "$real_db_path" 'SELECT count(*) FROM session' 2>/dev/null || echo "$real_db_before")"
fi
proof_log "real_db_after=$real_db_after"
if [ "$real_db_before" != "$real_db_after" ]; then
  proof_log "FAIL: real opencode DB session count changed"
  exit 1
fi

proof_log "PASS: observed session.error on isolated OpenCode SSE stream; real DB unchanged"
