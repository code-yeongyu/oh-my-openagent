#!/usr/bin/env bash
# db-session-by-name.sh - find opencode sessions whose TITLE matches a substring.
# Read-only against the LIVE opencode DB. Title search is cheap (the session
# table is small; ~21k rows scan in milliseconds), so no bounding is needed.
#
# Usage:
#   db-session-by-name.sh "auth refactor"        # newest 20 matches
#   db-session-by-name.sh "auth refactor" 50     # newest 50 matches
#   db-session-by-name.sh --self-test
#
# Output: JSON array of {id, title, created, updated} ordered newest first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

oqa_session_by_name() {
  local needle limit esc
  needle="$1"
  limit="${2:-20}"
  case "$limit" in (*[!0-9]*|"") limit=20 ;; esac
  esc="$(oqa_sql_escape "$needle")"
  oqa_db_query "SELECT
      id, title,
      datetime(time_created/1000,'unixepoch') AS created,
      datetime(time_updated/1000,'unixepoch') AS updated
    FROM session
    WHERE title LIKE '%$esc%'
    ORDER BY time_created DESC
    LIMIT $limit"
}

oqa_self_test() {
  oqa_require opencode jq || return 1
  # Derive a guaranteed-present needle: the first 5 chars of a real title.
  local needle out n
  needle="$(oqa_db_query "SELECT substr(title,1,5) AS t FROM session WHERE length(title)>=5 ORDER BY time_created DESC LIMIT 1" | jq -r '.[0].t // empty')"
  if [ -z "$needle" ]; then
    oqa_log "FAIL: could not derive a title needle"; return 1
  fi
  out="$(oqa_session_by_name "$needle" 5)"
  n="$(printf '%s' "$out" | jq 'length')"
  if [ "${n:-0}" -ge 1 ]; then
    oqa_pass "db-session-by-name found $n row(s) for needle '$needle'"
    return 0
  fi
  oqa_log "FAIL: expected >=1 row for needle '$needle', got '$n'"; return 1
}

case "${1:-}" in
  --self-test) oqa_self_test; exit $? ;;
  -h|--help|"")
    sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    [ -z "${1:-}" ] && exit 2 || exit 0 ;;
  *)
    oqa_require opencode jq || exit 1
    oqa_session_by_name "$1" "${2:-20}" ;;
esac
