#!/usr/bin/env bash
# db-session-by-text.sh - find opencode message TEXT by content.
#
# Message text lives inside the `part` table as JSON blobs
# (json_extract(data,'$.text') for text parts). The `part` table holds the bulk
# of the DB (tens of GB of tool output), so an UNBOUNDED text scan is refused.
# You MUST scope the search to a bounded, recent set of sessions:
#   --session ses_...    one session (indexed, instant)
#   --recent N           the N most-recent sessions (default 25)
#   --since "<window>"   sessions created within a window (e.g. "7 days"),
#                        capped at the 200 most-recent in that window
#
# All bounded modes use `part.session_id IN (SELECT id FROM session ORDER BY
# time_created DESC LIMIT ...)`, which drives the part_session_idx on exactly
# the newest sessions. (A naive JOIN with `WHERE session.time_created >= X`
# scans oldest-first and can take ~50s; the IN-subquery form returns in ~20ms.)
#
# Usage:
#   db-session-by-text.sh --session ses_3a4e... "ULTRAWORK"
#   db-session-by-text.sh --recent 50 "permission denied"
#   db-session-by-text.sh --since "7 days" --limit 50 "TODO"
#   db-session-by-text.sh --self-test
#
# Output: JSON array of {session_id, part_id, snippet} (snippet = first 120
# chars of the matching text part).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

oqa_text_scoped() {
  local sid needle limit esc_id esc_txt
  sid="$1"; needle="$2"; limit="${3:-50}"
  esc_id="$(oqa_sql_escape "$sid")"
  esc_txt="$(oqa_sql_escape "$needle")"
  oqa_db_query "SELECT
      p.session_id AS session_id,
      p.id         AS part_id,
      substr(json_extract(p.data,'\$.text'),1,120) AS snippet
    FROM part p
    WHERE p.session_id='$esc_id'
      AND json_extract(p.data,'\$.type')='text'
      AND json_extract(p.data,'\$.text') LIKE '%$esc_txt%'
    LIMIT $limit"
}

oqa_text_recent() {
  local n needle limit esc_txt
  n="$1"; needle="$2"; limit="${3:-50}"
  case "$n" in (*[!0-9]*|"") n=25 ;; esac
  esc_txt="$(oqa_sql_escape "$needle")"
  oqa_db_query "SELECT
      p.session_id AS session_id,
      p.id         AS part_id,
      substr(json_extract(p.data,'\$.text'),1,120) AS snippet
    FROM part p
    WHERE p.session_id IN (SELECT id FROM session ORDER BY time_created DESC LIMIT $n)
      AND json_extract(p.data,'\$.type')='text'
      AND json_extract(p.data,'\$.text') LIKE '%$esc_txt%'
    LIMIT $limit"
}

oqa_text_since() {
  local window needle limit esc_win esc_txt
  window="$1"; needle="$2"; limit="${3:-50}"
  esc_win="$(oqa_sql_escape "$window")"
  esc_txt="$(oqa_sql_escape "$needle")"
  # Cap at the 200 most-recent sessions inside the window and drive
  # part_session_idx via an IN-subquery (newest-first) to stay fast.
  oqa_db_query "SELECT
      p.session_id AS session_id,
      p.id         AS part_id,
      substr(json_extract(p.data,'\$.text'),1,120) AS snippet
    FROM part p
    WHERE p.session_id IN (
        SELECT id FROM session
        WHERE time_created >= (strftime('%s','now','-$esc_win') * 1000)
        ORDER BY time_created DESC LIMIT 200)
      AND json_extract(p.data,'\$.type')='text'
      AND json_extract(p.data,'\$.text') LIKE '%$esc_txt%'
    LIMIT $limit"
}

oqa_text_main() {
  local sid="" window="" recent="" limit=50 needle=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --session) sid="$2"; shift 2 ;;
      --recent)  recent="$2"; shift 2 ;;
      --since)   window="$2"; shift 2 ;;
      --limit)   limit="$2"; shift 2 ;;
      *)         needle="$1"; shift ;;
    esac
  done
  if [ -z "$needle" ]; then
    oqa_log "error: missing search text"; return 2
  fi
  if [ -n "$sid" ]; then
    oqa_text_scoped "$sid" "$needle" "$limit"; return 0
  fi
  if [ -n "$recent" ]; then
    oqa_text_recent "$recent" "$needle" "$limit"; return 0
  fi
  if [ -n "$window" ]; then
    oqa_text_since "$window" "$needle" "$limit"; return 0
  fi
  oqa_log "error: refusing an unbounded global text scan over the multi-GB part table."
  oqa_log "       scope it with --session <ses_id>, --recent <N>, or --since \"<N days|hours>\"."
  return 2
}

oqa_self_test() {
  oqa_require opencode jq || return 1
  local fails=0

  # 1) scoped: find a recent session with text parts, derive a needle from one.
  local sid needle out n
  sid="$(oqa_db_query "SELECT session_id AS s FROM part WHERE json_extract(data,'\$.type')='text' ORDER BY rowid DESC LIMIT 1" | jq -r '.[0].s // empty')"
  if [ -z "$sid" ]; then oqa_log "FAIL: no text parts found"; return 1; fi
  needle="$(oqa_db_query "SELECT substr(json_extract(data,'\$.text'),1,8) AS t FROM part WHERE session_id='$(oqa_sql_escape "$sid")' AND json_extract(data,'\$.type')='text' AND length(json_extract(data,'\$.text'))>=8 LIMIT 1" | jq -r '.[0].t // empty')"
  if [ -z "$needle" ]; then oqa_log "FAIL: could not derive a text needle"; return 1; fi
  out="$(oqa_text_main --session "$sid" "$needle")"
  n="$(printf '%s' "$out" | jq 'length')"
  if [ "${n:-0}" -ge 1 ]; then oqa_pass "scoped text search found $n row(s) in $sid"; else oqa_log "FAIL: scoped search empty for '$needle' in $sid"; fails=$((fails+1)); fi

  # 2) unbounded refusal: no --session/--since must exit 2.
  oqa_text_main "$needle" >/dev/null 2>&1
  if [ "$?" -eq 2 ]; then oqa_pass "unbounded global scan refused (exit 2)"; else oqa_log "FAIL: unbounded scan was not refused"; fails=$((fails+1)); fi

  # 3) bounded --recent search completes well under a hard 30s budget, even in
  #    the worst case (no early match) because the IN-subquery caps the scan to
  #    the newest N sessions and drives part_session_idx.
  local t0 t1
  t0=$(date +%s)
  oqa_text_main --recent 25 --limit 5 "oqa_no_match_$(date +%s)_zzz" >/dev/null 2>&1
  t1=$(date +%s)
  if [ $((t1 - t0)) -le 30 ]; then
    oqa_pass "bounded --recent 25 worst-case search completed in $((t1-t0))s (<=30s)"
  else
    oqa_log "FAIL: bounded --recent search took $((t1-t0))s (>30s)"; fails=$((fails+1))
  fi
  # also prove --recent returns real matches for the derived needle
  out="$(oqa_text_main --recent 25 --limit 5 "$needle" 2>/dev/null)"
  n="$(printf '%s' "$out" | jq 'length')"
  if [ "${n:-0}" -ge 1 ]; then oqa_pass "bounded --recent 25 found $n row(s) for '$needle'"; else oqa_log "FAIL: --recent found no rows for '$needle'"; fails=$((fails+1)); fi

  [ "$fails" -eq 0 ] && { oqa_pass "db-session-by-text"; return 0; }
  oqa_log "db-session-by-text had $fails failure(s)"; return 1
}

case "${1:-}" in
  --self-test) oqa_self_test; exit $? ;;
  -h|--help|"")
    sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    [ -z "${1:-}" ] && exit 2 || exit 0 ;;
  *)
    oqa_require opencode jq || exit 1
    oqa_text_main "$@" ;;
esac
