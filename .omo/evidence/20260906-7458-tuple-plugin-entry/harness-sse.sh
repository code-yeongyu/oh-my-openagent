#!/usr/bin/env bash
# Capture session.created on opencode's real /event SSE wire (isolated sandbox),
# while the GREEN probe records the fixed-function decision on the same hook.
set -uo pipefail
SKILL_DIR="$1"; PROBE="$2"; OUT="$3"; PROBE_OUT="$4"; RAW="$5"
. "$SKILL_DIR/scripts/lib/common.sh"
rm -f "$PROBE_OUT" "$RAW"

REALDB="$(opencode db path 2>/dev/null | tail -1)"
BEFORE="$(sqlite3 "$REALDB" 'SELECT count(*) FROM session' 2>/dev/null)"

oqa_mk_isolated_xdg || { echo "SANDBOX_FAILED" >"$OUT"; exit 1; }
export TMPDIR="$OQA_XDG_ROOT/tmp"; mkdir -p "$TMPDIR"
export PROBE_OUT
cp "$PROBE" "$OQA_XDG_ROOT/probe.js"
mkdir -p "$OQA_PROJ/.opencode"
cat > "$OQA_PROJ/.opencode/opencode.json" <<JSON
{ "plugin": [ ["opencode-auto-resume@1.1.10", { "chunkTimeoutMs": 300000 }], "oh-my-openagent@4.19.4", "file://$OQA_XDG_ROOT/probe.js" ] }
JSON

PORT="$(oqa_free_port)"; PASS="oqa-$RANDOM$RANDOM"; URL="http://127.0.0.1:$PORT"
cd "$OQA_PROJ"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 >"$XDG_STATE_HOME/serve.log" 2>&1 &
SRV=$!
SERVER_READY=no
oqa_wait_http "$URL/global/health" "opencode:$PASS" 90 && SERVER_READY=yes

# Attach the SSE /event stream BEFORE creating the session, capture raw.
curl -sN -u "opencode:$PASS" "$URL/event?directory=$OQA_PROJ" >"$RAW" 2>/dev/null &
CURLPID=$!
D=$(( $(date +%s) + 20 )); while [ "$(date +%s)" -lt "$D" ]; do grep -q 'server.connected' "$RAW" 2>/dev/null && break; sleep 0.2; done

# Trigger session.created.
curl -s -X POST -u "opencode:$PASS" -H 'Content-Type: application/json' -d '{}' \
  "$URL/session?directory=$OQA_PROJ" >"$OQA_XDG_ROOT/session.json" 2>/dev/null

SEEN=no
D=$(( $(date +%s) + 40 ))
while [ "$(date +%s)" -lt "$D" ]; do
  grep -q 'session.created' "$RAW" 2>/dev/null && { SEEN=yes; break; }
  sleep 0.3
done

kill "$CURLPID" 2>/dev/null
kill -TERM "$SRV" 2>/dev/null; sleep 2; kill -9 "$SRV" 2>/dev/null
AFTER="$(sqlite3 "$REALDB" 'SELECT count(*) FROM session' 2>/dev/null)"
ALL_TYPES="$(grep -o '"type":"[^"]*"' "$RAW" 2>/dev/null | sort | uniq -c | sort -rn | head -20 | tr '\n' ';')"
CREATED_LINE="$(grep -m1 'session.created' "$RAW" 2>/dev/null | sed 's/^data: //' | cut -c1-200)"

{
  echo "opencode: $(opencode --version 2>/dev/null)"
  echo "server_ready: $SERVER_READY"
  echo "session_created_on_sse_wire: $SEEN"
  echo "session_created_line: ${CREATED_LINE:-<none>}"
  echo "sse_event_type_histogram: $ALL_TYPES"
  echo "probe_decision: $(cat "$PROBE_OUT" 2>/dev/null | tr -d '\n' | cut -c1-300)"
  echo "real_db_sessions_before: $BEFORE"
  echo "real_db_sessions_after: $AFTER"
} >"$OUT"
oqa_cleanup 2>/dev/null || true
cat "$OUT"
