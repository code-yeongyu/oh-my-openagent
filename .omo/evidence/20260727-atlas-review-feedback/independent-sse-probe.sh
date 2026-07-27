#!/usr/bin/env bash
# independent-sse-probe.sh - confirm the SSE wire shape that the new
# Atlas event-handler resolves. Does not invoke the plugin; drives a
# real isolated opencode serve, posts one prompt_async, and asserts:
#   * at least one message.updated with role:user fires
#   * the part arrives separately via message.part.updated
#   * message.part.updated carries the text but no role on info
# Writes a JSON-shaped summary to stdout and the raw stream to the
# evidence dir.
set -uo pipefail

SCRIPT_DIR="/mnt/data/code/oh-my-opencode/fix-atlas-reviewer-loop/.agents/skills/opencode-qa/scripts"
. "$SCRIPT_DIR/lib/common.sh"

EVIDENCE_DIR="${1:-}"

oqa_start_server || { oqa_log "no server"; exit 1; }

url="$OQA_SERVER_URL"
pass="$OQA_SERVER_PASS"
proj="$OQA_PROJ"
auth="opencode:$pass"

raw="$XDG_STATE_HOME/sse-raw.txt"
watched="$XDG_STATE_HOME/sse-watched.txt"
: >"$raw"
: >"$watched"

curl -sN -u "$auth" "$url/event?directory=$proj" >"$raw" 2>/dev/null &
wpid=$!
OQA_CURL_PIDS+=("$wpid")
disown "$wpid" 2>/dev/null || true

sleep 0.5

session_json="$(curl -s -u "$auth" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"title":"atlas-ind-qa","agent":"build"}' \
  "$url/session?directory=$proj")"
session_id="$(printf '%s' "$session_json" | jq -r '.id // empty')"
if [ -z "$session_id" ]; then
  oqa_log "FAIL: could not create session; response: $session_json"
  exit 1
fi

prompt_status="$(curl -s -u "$auth" -o /dev/null -w '%{http_code}' \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"atlas-independent-approval-qa"}]}' \
  "$url/session/$session_id/prompt_async?directory=$proj")"

deadline=$(( $(date +%s) + 20 ))
last_size=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  cur_size="$(wc -c <"$raw" 2>/dev/null | tr -d ' ')"
  if [ "$cur_size" != "$last_size" ]; then
    last_size="$cur_size"
  fi
  if grep -q "atlas-independent-approval-qa" "$raw" 2>/dev/null; then
    break
  fi
  sleep 0.3
done

sleep 1

cp "$raw" "$watched"

count_lines() {
  local pattern="$1" file="$2"
  local n
  n="$(grep -c "$pattern" "$file" 2>/dev/null || true)"
  if [ -z "$n" ]; then n=0; fi
  printf '%s' "$n"
}

message_updated_user="$(count_lines '"type":"message.updated"' "$raw")"
message_part_updated="$(count_lines '"type":"message.part.updated"' "$raw")"
user_role_on_updated="$(grep '"type":"message.updated"' "$raw" | grep -c '"role":"user"' || true)"
[ -z "$user_role_on_updated" ] && user_role_on_updated=0
part_with_text="$(grep '"type":"message.part.updated"' "$raw" | grep -c '"text":"atlas-independent-approval-qa"' || true)"
[ -z "$part_with_text" ] && part_with_text=0
part_info_with_role="$(grep '"type":"message.part.updated"' "$raw" | grep -c '"info":' || true)"
[ -z "$part_info_with_role" ] && part_info_with_role=0
part_role_user="$(grep '"type":"message.part.updated"' "$raw" | grep -c '"info":{"id":"[^"]*","role":"user"' || true)"
[ -z "$part_role_user" ] && part_role_user=0

verdict_pass=0
if [ "$prompt_status" = "204" ] \
   && [ "$message_updated_user" -ge 1 ] \
   && [ "$message_part_updated" -ge 1 ] \
   && [ "$user_role_on_updated" -ge 1 ] \
   && [ "$part_with_text" -ge 1 ] \
   && [ "$part_info_with_role" -eq 0 ]; then
  verdict_pass=1
fi

if [ -n "$EVIDENCE_DIR" ]; then
  mkdir -p "$EVIDENCE_DIR"
  cp "$raw" "$EVIDENCE_DIR/sse-raw-ind.txt"
  {
    printf 'prompt_async_status=%s\n' "$prompt_status"
    printf 'session_id=%s\n' "$session_id"
    printf 'message_updated_events=%s\n' "$message_updated_user"
    printf 'message_part_updated_events=%s\n' "$message_part_updated"
    printf 'message_updated_with_user_role=%s\n' "$user_role_on_updated"
    printf 'message_part_updated_with_target_text=%s\n' "$part_with_text"
    printf 'message_part_updated_with_info=%s\n' "$part_info_with_role"
    printf 'message_part_updated_with_user_role=%s\n' "$part_role_user"
    printf 'verdict=%s\n' "$verdict_pass"
  } >"$EVIDENCE_DIR/sse-wire-summary.txt"
fi

printf '{"prompt_async_status":%s,"message_updated":%s,"message_part_updated":%s,"updated_user_role":%s,"part_with_text":%s,"part_info_count":%s,"part_user_role_count":%s,"verdict_pass":%s}\n' \
  "$prompt_status" \
  "$message_updated_user" \
  "$message_part_updated" \
  "$user_role_on_updated" \
  "$part_with_text" \
  "$part_info_with_role" \
  "$part_role_user" \
  "$verdict_pass"

exit $(( 1 - verdict_pass ))
