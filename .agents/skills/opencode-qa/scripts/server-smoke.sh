#!/usr/bin/env bash
# server-smoke.sh - boot an ISOLATED opencode HTTP server and verify the core
# API surface end to end. Uses an isolated XDG sandbox + a random password, so
# it never touches the real ~/.local/share/opencode DB, and tears the server
# down on exit.
#
# Checks:
#   1. GET /global/health            -> {"healthy":true,"version":...}
#   2. GET /doc                      -> OpenAPI spec with >=100 paths
#   3. GET /session (no credentials) -> HTTP 401 (auth is enforced)
#
# Usage:
#   server-smoke.sh              # run the smoke test
#   server-smoke.sh --self-test  # same thing (alias for the QA sweep)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

oqa_server_smoke() {
  oqa_require opencode curl jq || return 1
  if ! oqa_start_server; then
    oqa_log "FAIL: server did not become ready"; return 1
  fi
  local url="$OQA_SERVER_URL" auth="opencode:$OQA_SERVER_PASS" fails=0

  local healthy version
  healthy="$(curl -s -u "$auth" "$url/global/health" | jq -r '.healthy // false')"
  version="$(curl -s -u "$auth" "$url/global/health" | jq -r '.version // "?"')"
  if [ "$healthy" = "true" ]; then
    oqa_pass "GET /global/health healthy=true version=$version ($url)"
  else
    oqa_log "FAIL: /global/health healthy=$healthy"; fails=$((fails+1))
  fi

  local npaths
  npaths="$(curl -s -u "$auth" "$url/doc" | jq '.paths | length' 2>/dev/null)"
  if [ "${npaths:-0}" -ge 100 ]; then
    oqa_pass "GET /doc lists $npaths documented paths (>=100)"
  else
    oqa_log "FAIL: /doc path count=$npaths"; fails=$((fails+1))
  fi

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url/session?directory=$OQA_PROJ")"
  if [ "$code" = "401" ]; then
    oqa_pass "unauthenticated GET /session rejected with HTTP 401"
  else
    oqa_log "FAIL: unauthenticated /session returned $code (expected 401)"; fails=$((fails+1))
  fi

  if [ "$fails" -eq 0 ]; then
    oqa_pass "server-smoke"
    return 0
  fi
  oqa_log "server-smoke had $fails failure(s)"; return 1
}

case "${1:-}" in
  -h|--help)
    sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *)
    oqa_server_smoke; exit $? ;;
esac
