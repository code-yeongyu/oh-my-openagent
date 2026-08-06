#!/usr/bin/env bash
# sse-hook-probe.sh - QA opencode's event stream (the plumbing behind hooks).
#
# opencode publishes lifecycle events over Server-Sent Events at GET /event
# (per-instance) and GET /global/event. Plugins observe the same events via the
# `event` hook, so confirming an event on the wire is how you prove a hook
# would have fired.
#
# Two modes:
#   (default / --self-test)  Spawn an ISOLATED server and assert the stream
#                            opens with a `server.connected` event. No real DB
#                            is touched. This proves the SSE plumbing works.
#   --attach <url>           Watch an ALREADY-RUNNING server's /event stream for
#                            a specific event type (default: server.connected).
#                            Use this against your real server to verify a hook
#                            or action. Pair it with a prompt in another shell:
#                              curl -X POST -u opencode:$PASS \
#                                -H 'Content-Type: application/json' \
#                                -d '{"parts":[{"type":"text","text":"hi"}]}' \
#                                "<url>/session/<ses_id>/prompt_async?directory=<dir>"
#                            then watch for e.g. message.part.updated.
#
# --attach options:
#   --password <p>   server password (user defaults to "opencode")
#   --user <u>       server username (default: opencode)
#   --directory <d>  instance directory (default: $PWD)
#   --event <type>   event type to wait for (default: server.connected)
#   --timeout <s>    seconds to wait (default: 15)
#
# Usage:
#   sse-hook-probe.sh --self-test
#   sse-hook-probe.sh --attach http://127.0.0.1:4096 --password secret \
#       --directory "$PWD" --event message.part.updated --timeout 30

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

# Watch an SSE stream for an event type. Args: url auth directory event timeout
# Returns 0 if seen, 1 otherwise. Always kills its curl watcher.
oqa_sse_watch() {
  local url="$1" auth="$2" dir="$3" want="$4" timeout="${5:-15}"
  local out cpid found="" deadline
  out="$(mktemp -t oqa-sse.XXXXXX)"; OQA_TMPDIRS+=("$out")
  if [ -n "$auth" ]; then
    curl -sN -u "$auth" "$url/event?directory=$dir" >"$out" 2>/dev/null &
  else
    curl -sN "$url/event?directory=$dir" >"$out" 2>/dev/null &
  fi
  cpid=$!; OQA_CURL_PIDS+=("$cpid")
  disown "$cpid" 2>/dev/null || true
  deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if grep -q "\"$want\"" "$out" 2>/dev/null; then found=1; break; fi
    kill -0 "$cpid" 2>/dev/null || break
    sleep 0.2
  done
  kill "$cpid" 2>/dev/null || true
  sleep 0.1
  kill -0 "$cpid" 2>/dev/null && kill -9 "$cpid" 2>/dev/null || true
  if [ -n "$found" ]; then
    printf 'first matching event: '
    grep -m1 "\"$want\"" "$out" | sed 's/^data: //' | jq -c '{type: .type}' 2>/dev/null || true
    return 0
  fi
  oqa_log "stream head (no '$want' within ${timeout}s):"; head -5 "$out" >&2
  return 1
}

oqa_self_test() {
  oqa_require opencode curl jq || return 1
  if ! oqa_start_server; then oqa_log "FAIL: server did not start"; return 1; fi
  if oqa_sse_watch "$OQA_SERVER_URL" "opencode:$OQA_SERVER_PASS" "$OQA_PROJ" "server.connected" 15; then
    oqa_pass "SSE /event opened and delivered server.connected"
    return 0
  fi
  oqa_log "FAIL: did not observe server.connected"; return 1
}

oqa_attach_mode() {
  local url="" user="opencode" pass="" dir="$PWD" event="server.connected" timeout=15
  shift # drop --attach
  url="$1"; shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --password) pass="$2"; shift 2 ;;
      --user)     user="$2"; shift 2 ;;
      --directory) dir="$2"; shift 2 ;;
      --event)    event="$2"; shift 2 ;;
      --timeout)  timeout="$2"; shift 2 ;;
      *) oqa_log "unknown option: $1"; shift ;;
    esac
  done
  [ -n "$url" ] || { oqa_log "error: --attach requires a URL"; return 2; }
  local auth=""; [ -n "$pass" ] && auth="$user:$pass"
  oqa_log "watching $url/event?directory=$dir for '$event' (<=${timeout}s)"
  if oqa_sse_watch "$url" "$auth" "$dir" "$event" "$timeout"; then
    oqa_pass "observed '$event' on $url"
    return 0
  fi
  oqa_log "FAIL: '$event' not observed"; return 1
}

case "${1:-}" in
  --attach) oqa_attach_mode "$@"; exit $? ;;
  -h|--help)
    sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *) oqa_self_test; exit $? ;;
esac
