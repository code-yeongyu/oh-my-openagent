#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$script_dir/../../.." && pwd)"
common="$repo/.agents/skills/opencode-qa/scripts/lib/common.sh"
fake_server="$repo/.agents/skills/opencode-qa/scripts/lib/fake-openai-server.mjs"
bundle="$repo/dist/index.js"
opencode_bin="$(command -v opencode)"
original_home="$HOME"
fake_pid=""

# shellcheck source=/dev/null
. "$common"

cleanup_all() {
  oqa_cleanup
  if [[ -n "$fake_pid" ]]; then
    kill "$fake_pid" 2>/dev/null || true
    wait "$fake_pid" 2>/dev/null || true
    fake_pid=""
  fi
}
trap cleanup_all EXIT

host_db="$($opencode_bin db path 2>/dev/null | head -1)"
host_before="$(sqlite3 "$host_db" 'SELECT count(*) FROM session;')"
bundle_sha256="$(shasum -a 256 "$bundle" | awk '{print $1}')"
opencode_version="$($opencode_bin --version)"

fake_port="$(oqa_free_port)"
rm -f "$script_dir/fake-llm.log" "$script_dir/fake-llm.stdout.log"
FAKE_OPENAI_PORT="$fake_port" FAKE_LLM_LOG="$script_dir/fake-llm.log" \
  node "$fake_server" >"$script_dir/fake-llm.stdout.log" 2>&1 &
fake_pid=$!
if ! oqa_wait_http "http://127.0.0.1:$fake_port/health" "" 15; then
  cat "$script_dir/fake-llm.stdout.log" >&2
  exit 1
fi
fake_pid_snapshot="$fake_pid"

oqa_mk_isolated_xdg
sandbox_root="$OQA_XDG_ROOT"
mkdir -p "$XDG_CONFIG_HOME/opencode"

jq -n \
  --arg plugin "file://$bundle" \
  --arg base_url "http://127.0.0.1:$fake_port/v1" \
  '{
    plugin: [$plugin],
    model: "openai/gpt-fake",
    provider: {
      openai: {
        options: {apiKey: "fake-key", baseURL: $base_url, timeout: 30000},
        models: {
          "gpt-fake": {
            tool_call: true,
            limit: {context: 200000, output: 8192}
          }
        }
      }
    }
  }' >"$XDG_CONFIG_HOME/opencode/opencode.json"

cat >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json" <<'JSON'
{
  "agents": {
    "sisyphus": {
      "model": "openai/gpt-fake"
    }
  }
}
JSON

server_port="$(oqa_free_port)"
server_pass="oqa-${RANDOM}${RANDOM}"
OPENCODE_SERVER_PASSWORD="$server_pass" "$opencode_bin" serve \
  --port "$server_port" --hostname 127.0.0.1 \
  >"$XDG_STATE_HOME/serve.log" 2>&1 &
OQA_SERVER_PID=$!
server_pid_snapshot="$OQA_SERVER_PID"
OQA_SERVER_URL="http://127.0.0.1:$server_port"
OQA_SERVER_PASS="$server_pass"
if ! oqa_wait_http "$OQA_SERVER_URL/global/health" "opencode:$server_pass" 30; then
  cat "$XDG_STATE_HOME/serve.log" >&2
  exit 1
fi

health="$(curl -fsS -u "opencode:$server_pass" "$OQA_SERVER_URL/global/health")"
config_summary="$(
  curl -fsS -u "opencode:$server_pass" "$OQA_SERVER_URL/config?directory=$repo" \
    | jq -c '{plugin: (.plugin // []), model: .model}'
)"
expected_plugin="file://$bundle"
if ! jq -e --arg expected "$expected_plugin" '.plugin | index($expected) != null' \
  <<<"$config_summary" >/dev/null; then
  printf 'source bundle missing from loaded plugin config: %s\n' "$config_summary" >&2
  exit 1
fi

session_id="$(
  curl -fsS -u "opencode:$server_pass" \
    -H 'Content-Type: application/json' -X POST -d '{}' \
    "$OQA_SERVER_URL/session?directory=$repo" \
    | jq -er '.id'
)"

sse_fifo="$XDG_STATE_HOME/events.fifo"
mkfifo "$sse_fifo"
curl -fsSN -u "opencode:$server_pass" \
  "$OQA_SERVER_URL/event?directory=$repo" >"$sse_fifo" &
sse_pid=$!
OQA_CURL_PIDS+=("$sse_pid")
exec 3<"$sse_fifo"

connected=0
deadline=$((SECONDS + 15))
while (( SECONDS < deadline )); do
  if IFS= read -r -t 1 line <&3; then
    if [[ "$line" == data:* && "$line" == *'"server.connected"'* ]]; then
      connected=1
      break
    fi
  fi
done
[[ "$connected" -eq 1 ]]

prompt_status="$(
  curl -sS -o "$XDG_STATE_HOME/prompt-response.txt" -w '%{http_code}' \
    -u "opencode:$server_pass" \
    -H 'Content-Type: application/json' -X POST \
    -d '{"parts":[{"type":"text","text":"reply exactly PR6611_QA_OK"}]}' \
    "$OQA_SERVER_URL/session/$session_id/prompt_async?directory=$repo"
)"
[[ "$prompt_status" == "204" ]]

status_seen=0
message_seen=0
part_seen=0
part_event=''
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  if IFS= read -r -t 1 line <&3; then
    [[ "$line" == data:* ]] || continue
    [[ "$line" == *'"session.status"'* ]] && status_seen=1
    [[ "$line" == *'"message.updated"'* ]] && message_seen=1
    if [[ "$line" == *'"message.part.updated"'* && "$line" == *'fake response'* ]]; then
      part_seen=1
      part_event="$(sed 's/^data: //' <<<"$line" | jq -c '{type, sessionID: (.properties.part.sessionID // .properties.sessionID // null), text: (.properties.part.text // null)}')"
    fi
    if [[ "$status_seen" -eq 1 && "$message_seen" -eq 1 && "$part_seen" -eq 1 ]]; then
      break
    fi
  fi
done
[[ "$status_seen" -eq 1 ]]
[[ "$message_seen" -eq 1 ]]
[[ "$part_seen" -eq 1 ]]

sandbox_db="$($opencode_bin db path 2>/dev/null | head -1)"
[[ "$sandbox_db" == "$sandbox_root"/* ]]
sandbox_sessions="$(sqlite3 "$sandbox_db" 'SELECT count(*) FROM session;')"
[[ "$sandbox_sessions" -ge 1 ]]
fake_default_calls="$(grep -c 'branch=default' "$script_dir/fake-llm.log" || true)"
[[ "$fake_default_calls" -ge 1 ]]

cp "$XDG_STATE_HOME/serve.log" "$script_dir/opencode-serve.log"
exec 3<&-
kill "$sse_pid" 2>/dev/null || true
wait "$sse_pid" 2>/dev/null || true
OQA_CURL_PIDS=()

oqa_cleanup
server_stopped=true
kill -0 "$server_pid_snapshot" 2>/dev/null && server_stopped=false
sandbox_removed=false
[[ ! -e "$sandbox_root" ]] && sandbox_removed=true

kill "$fake_pid" 2>/dev/null || true
wait "$fake_pid" 2>/dev/null || true
fake_pid=""
fake_server_stopped=true
kill -0 "$fake_pid_snapshot" 2>/dev/null && fake_server_stopped=false

host_after="$(sqlite3 "$host_db" 'SELECT count(*) FROM session;')"

printf 'opencode_version=%s\n' "$opencode_version"
printf 'bundle_sha256=%s\n' "$bundle_sha256"
printf 'health=%s\n' "$health"
printf 'config_summary=%s\n' "$config_summary"
printf 'session_id=%s\n' "$session_id"
printf 'prompt_http_status=%s\n' "$prompt_status"
printf 'sse_server_connected=%s\n' "$connected"
printf 'sse_session_status_seen=%s\n' "$status_seen"
printf 'sse_message_updated_seen=%s\n' "$message_seen"
printf 'sse_part_event=%s\n' "$part_event"
printf 'fake_default_calls=%s\n' "$fake_default_calls"
printf 'sandbox_db=%s\n' "$sandbox_db"
printf 'sandbox_sessions=%s\n' "$sandbox_sessions"
printf 'host_db=%s\n' "$host_db"
printf 'host_db_sessions_before=%s\n' "$host_before"
printf 'host_db_sessions_after=%s\n' "$host_after"
printf 'sandbox_root=%s\n' "$sandbox_root"
printf 'sandbox_removed=%s\n' "$sandbox_removed"
printf 'opencode_server_stopped=%s\n' "$server_stopped"
printf 'fake_server_stopped=%s\n' "$fake_server_stopped"

[[ "$host_before" == "$host_after" ]]
[[ "$sandbox_removed" == "true" ]]
[[ "$server_stopped" == "true" ]]
[[ "$fake_server_stopped" == "true" ]]
