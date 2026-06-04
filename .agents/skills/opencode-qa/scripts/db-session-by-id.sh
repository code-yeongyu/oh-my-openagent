#!/usr/bin/env bash
# db-session-by-id.sh - investigate an opencode session by its id (ses_...).
# Read-only against the LIVE opencode DB via `opencode db ... --format json`.
#
# Usage:
#   db-session-by-id.sh ses_3a4ee6335ffedFB8f76BPU1Eb3
#   db-session-by-id.sh --self-test
#
# Output: a JSON array with one row (id, slug, title, directory, agent, model,
# cost, token counts, human-readable created/updated times) or [] if not found.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

oqa_session_by_id() {
  local id esc
  id="$1"
  esc="$(oqa_sql_escape "$id")"
  oqa_db_query "SELECT
      id, slug, title, directory, agent,
      json_extract(model,'\$.modelID')   AS model,
      json_extract(model,'\$.providerID') AS provider,
      cost, tokens_input, tokens_output,
      datetime(time_created/1000,'unixepoch') AS created,
      datetime(time_updated/1000,'unixepoch') AS updated
    FROM session WHERE id='$esc'"
}

oqa_self_test() {
  oqa_require opencode jq || return 1
  local id out got
  id="$(oqa_db_query "SELECT id FROM session ORDER BY time_created DESC LIMIT 1" | jq -r '.[0].id // empty')"
  if [ -z "$id" ]; then
    oqa_log "FAIL: no sessions in DB to test against"; return 1
  fi
  out="$(oqa_session_by_id "$id")"
  got="$(printf '%s' "$out" | jq -r '.[0].id // empty')"
  if [ "$got" = "$id" ]; then
    oqa_pass "db-session-by-id round-trips id ($id)"
    return 0
  fi
  oqa_log "FAIL: expected id '$id', got '$got'"; return 1
}

case "${1:-}" in
  --self-test) oqa_self_test; exit $? ;;
  -h|--help|"")
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    [ -z "${1:-}" ] && exit 2 || exit 0 ;;
  *)
    oqa_require opencode jq || exit 1
    oqa_session_by_id "$1" ;;
esac
