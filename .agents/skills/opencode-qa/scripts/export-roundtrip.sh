#!/usr/bin/env bash
# export-roundtrip.sh - export a session as clean JSON and verify it round-trips.
#
# `opencode export <id>` prints a human line ("Exporting session: ...") to
# STDERR and the JSON document to STDOUT, so suppress stderr before piping to jq.
# The JSON shape is { info: {id, slug, projectID, directory, title, tokens,
# time, ...}, messages: [...] }.
#
# Usage:
#   export-roundtrip.sh ses_3a4e22ad5ffebMKLt0tL7exPjZ   # prints clean JSON
#   export-roundtrip.sh --self-test
#
# Tip: redirect to a file for archival: export-roundtrip.sh <id> > session.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

oqa_export() {
  # stderr carries the "Exporting session:" banner; drop it for clean JSON.
  opencode export "$1" 2>/dev/null
}

oqa_self_test() {
  oqa_require opencode jq || return 1
  local id out got title msgtype
  id="$(oqa_db_query "SELECT id FROM session ORDER BY time_created DESC LIMIT 1" | jq -r '.[0].id // empty')"
  if [ -z "$id" ]; then oqa_log "FAIL: no sessions to export"; return 1; fi

  out="$(oqa_export "$id")"
  # 1) stdout must be valid JSON (stderr banner excluded).
  if ! printf '%s' "$out" | jq -e . >/dev/null 2>&1; then
    oqa_log "FAIL: export stdout is not valid JSON for $id"; return 1
  fi
  # 2) the info.id must round-trip.
  got="$(printf '%s' "$out" | jq -r '.info.id // empty')"
  if [ "$got" != "$id" ]; then
    oqa_log "FAIL: export .info.id '$got' != '$id'"; return 1
  fi
  # 3) info.title is a string and messages is an array.
  title="$(printf '%s' "$out" | jq -r '.info.title|type' 2>/dev/null)"
  msgtype="$(printf '%s' "$out" | jq -r '.messages|type' 2>/dev/null)"
  if [ "$title" = "string" ] && { [ "$msgtype" = "array" ] || [ "$msgtype" = "null" ]; }; then
    oqa_pass "export round-trips $id (info.id matches, valid JSON)"
    return 0
  fi
  oqa_log "FAIL: unexpected shape (title=$title messages=$msgtype)"; return 1
}

case "${1:-}" in
  --self-test) oqa_self_test; exit $? ;;
  -h|--help|"")
    sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    [ -z "${1:-}" ] && exit 2 || exit 0 ;;
  *)
    oqa_require opencode jq || exit 1
    oqa_export "$1" ;;
esac
