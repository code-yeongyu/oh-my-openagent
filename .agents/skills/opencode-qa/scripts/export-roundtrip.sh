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
  local id="$1" out
  out="$(mktemp -t oqa-export.XXXXXX)" || return 1
  OQA_TMPDIRS+=("$out")
  oqa_export_to_file "$id" "$out" || return 1
  oqa_validate_export_file "$id" "$out" || return 1
  cat "$out"
}

oqa_extract_json_stdout() {
  local raw="$1" clean="$2"
  awk '
    BEGIN { started = 0 }
    started { print; next }
    {
      pos = index($0, "{")
      if (pos > 0) {
        print substr($0, pos)
        started = 1
      }
    }
  ' "$raw" >"$clean"
}

oqa_export_to_file() {
  local id="$1" out="$2" raw
  if [ -z "$id" ]; then
    oqa_log "FAIL: missing session id"
    return 2
  fi
  raw="$(mktemp -t oqa-export-raw.XXXXXX)" || return 1
  OQA_TMPDIRS+=("$raw")
  opencode export "$id" >"$raw" 2>/dev/null || return 1
  oqa_extract_json_stdout "$raw" "$out"
}

oqa_validate_export_file() {
  local id="$1" file="$2" got title msgtype
  if ! jq -e . "$file" >/dev/null 2>&1; then
    oqa_log "FAIL: export stdout is not valid JSON for $id"
    return 1
  fi
  got="$(jq -r '.info.id // empty' "$file")"
  if [ "$got" != "$id" ]; then
    oqa_log "FAIL: export .info.id '$got' != '$id'"
    return 1
  fi
  title="$(jq -r '.info.title|type' "$file" 2>/dev/null)"
  msgtype="$(jq -r '.messages|type' "$file" 2>/dev/null)"
  if [ "$title" = "string" ] && { [ "$msgtype" = "array" ] || [ "$msgtype" = "null" ]; }; then
    return 0
  fi
  oqa_log "FAIL: unexpected shape (title=$title messages=$msgtype)"
  return 1
}

oqa_self_test() {
  oqa_require opencode jq || return 1
  local id out
  id="$(oqa_db_query "SELECT id FROM session ORDER BY time_created DESC LIMIT 1" | jq -r '.[0].id // empty')"
  if [ -z "$id" ]; then oqa_log "FAIL: no sessions to export"; return 1; fi

  out="$(mktemp -t oqa-export.XXXXXX)" || return 1
  OQA_TMPDIRS+=("$out")
  oqa_export_to_file "$id" "$out" || return 1
  oqa_validate_export_file "$id" "$out" || return 1
  oqa_pass "export round-trips $id (info.id matches, valid JSON)"
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
