#!/usr/bin/env bash
set -euo pipefail

repo="/mnt/c/Users/pss/OneDrive/Documents/github/oh-my-openagent-6579"
evidence="$repo/.omo/evidence/20260813-pr6611-variant-reset"
common="$repo/.agents/skills/opencode-qa/scripts/lib/common.sh"
bundle="$repo/dist/index.js"
orig_home="$HOME"
export PATH="$HOME/.opencode/bin:$PATH"

real_count() {
  env \
    -u XDG_DATA_HOME \
    -u XDG_CONFIG_HOME \
    -u XDG_CACHE_HOME \
    -u XDG_STATE_HOME \
    HOME="$orig_home" \
    opencode db "SELECT count(*) AS count FROM session" --format json 2>/dev/null \
    | jq -r '.[0].count // 0'
}

real_before="$(real_count)"
export OPENCODE_CONFIG="$evidence/opencode.json"
bundle_sha256="$(sha256sum "$bundle" | awk '{print $1}')"
bundle_variant_wiring=false
if grep -Fq 'output.message.variant ?? input.variant' "$bundle" \
  && grep -Fq 'const parsedModel = parseModelString(runtimeModel);' "$bundle" \
  && grep -Fq 'fallbackState.pendingFallbackModel = effectiveRetryModel;' "$bundle" \
  && grep -Fq 'clearFallbackWatchdog(sessionID);' "$bundle" \
  && grep -Fq 'clearModelLessRetryKeys(sessionID);' "$bundle" \
  && grep -Fq 'areRuntimeModelsEquivalent(' "$bundle" \
  && grep -Fq 'resolveAgentVariant(pluginConfig, resolvedAgent)' "$bundle" \
  && grep -Eq '=== fallbackState' "$bundle" \
  && grep -Fq 'lowerReasoningForModel(' "$bundle" \
  && [ "$(grep -Fo 'resolveAgentVariant(pluginConfig,' "$bundle" | wc -l)" -ge 2 ] \
  && grep -Fq 'retryDispatched = true' "$bundle" \
  && grep -Fq 'buildRetryModelPayload(fallbackModel' "$bundle" \
  && grep -Fq 'part.synthetic === true' "$bundle" \
  && grep -Fq 'Session fallback timeout skipped for stale state generation' "$bundle"; then
  bundle_variant_wiring=true
fi

normalized_common="$(mktemp -t opencode-qa-common.XXXXXX)"
tr -d '\r' < "$common" > "$normalized_common"
# shellcheck source=/dev/null
. "$normalized_common"
rm -f "$normalized_common"

oqa_wait_http() {
  local url="$1"
  local auth="${2:-}"
  local timeout="${3:-25}"
  local deadline=$(( $(date +%s) + timeout ))

  while [[ "$(date +%s)" -lt "$deadline" ]]; do
    if [[ -n "$auth" ]]; then
      curl -s --max-time 1 -o /dev/null -u "$auth" "$url" && return 0
    else
      curl -s --max-time 1 -o /dev/null "$url" && return 0
    fi
  done
  return 1
}

oqa_start_server
server_pid="$OQA_SERVER_PID"
sandbox_root="$OQA_XDG_ROOT"

health="$(curl -fsS -u "opencode:$OQA_SERVER_PASS" "$OQA_SERVER_URL/global/health")"
config_plugins="$(
  curl -fsS -u "opencode:$OQA_SERVER_PASS" "$OQA_SERVER_URL/config?directory=$repo" \
    | jq -c '.plugin // .plugin_origins // []'
)"
session_id="$(
  curl -fsS \
    -u "opencode:$OQA_SERVER_PASS" \
    -H "Content-Type: application/json" \
    -X POST \
    -d '{}' \
    "$OQA_SERVER_URL/session?directory=$repo" \
    | jq -r '.id'
)"

coproc SSE_STREAM {
  curl -fsSN \
    -u "opencode:$OQA_SERVER_PASS" \
    "$OQA_SERVER_URL/event?directory=$repo"
}

ready=0
while IFS= read -r -t 30 line <&"${SSE_STREAM[0]}"; do
  if [[ "$line" == *"server.connected"* ]]; then
    ready=1
    break
  fi
done
if [[ "$ready" -ne 1 ]]; then
  printf 'sse_ready=false\n'
  exit 1
fi

prompt_status="$(
  curl -sS \
    -o "$XDG_STATE_HOME/prompt-response.txt" \
    -w "%{http_code}" \
    -u "opencode:$OQA_SERVER_PASS" \
    -H "Content-Type: application/json" \
    -X POST \
    -d '{"parts":[{"type":"text","text":"reply with ok"}]}' \
    "$OQA_SERVER_URL/session/$session_id/prompt_async?directory=$repo"
)"

seen=0
matching=""
while IFS= read -r -t 45 line <&"${SSE_STREAM[0]}"; do
  if [[ "$line" == *"session.status"* ]]; then
    seen=1
    matching="$line"
    break
  fi
done

kill "$SSE_STREAM_PID" 2>/dev/null || true
wait "$SSE_STREAM_PID" 2>/dev/null || true

if [[ "$seen" -ne 1 ]]; then
  printf 'session_status_seen=false\n'
  exit 1
fi

pkill -TERM -P "$server_pid" 2>/dev/null || true
oqa_cleanup
wait "$server_pid" 2>/dev/null || true
sandbox_removed=false
if [[ ! -e "$sandbox_root" ]]; then
  sandbox_removed=true
fi
real_after="$(real_count)"

printf 'opencode_version=%s\n' "$(opencode --version)"
printf 'bundle_sha256=%s\n' "$bundle_sha256"
printf 'bundle_variant_wiring=%s\n' "$bundle_variant_wiring"
printf 'health=%s\n' "$health"
printf 'config_plugins=%s\n' "$config_plugins"
printf 'session_id=%s\n' "$session_id"
printf 'prompt_http_status=%s\n' "$prompt_status"
printf 'sse_event=%s\n' "$(
  printf '%s' "$matching" \
    | sed 's/^data: //' \
    | jq -c '{type: .type}'
)"
printf 'real_db_sessions_before=%s\n' "$real_before"
printf 'real_db_sessions_after=%s\n' "$real_after"
printf 'sandbox_root=%s\n' "$sandbox_root"
printf 'sandbox_removed=%s\n' "$sandbox_removed"

[[ "$prompt_status" == "204" ]]
[[ "$bundle_variant_wiring" == "true" ]]
[[ "$real_before" == "$real_after" ]]
[[ "$sandbox_removed" == "true" ]]
