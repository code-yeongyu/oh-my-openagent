#!/usr/bin/env bash
# Real-OpenCode harness QA v3 for issue #7458 — probe plugin exercises the fixed
# functions (findPluginEntry + isLocalDevMode) inside opencode's real
# session.created hook, with a tuple-style plugin entry preceding the omo entry.
set -uo pipefail
SKILL_DIR="$1"; PROBE="$2"; LABEL="$3"; OUT="$4"; PROBE_OUT="$5"
. "$SKILL_DIR/scripts/lib/common.sh"
rm -f "$PROBE_OUT"

REALDB="$(opencode db path 2>/dev/null | tail -1)"
BEFORE="$(sqlite3 "$REALDB" 'SELECT count(*) FROM session' 2>/dev/null)"

oqa_mk_isolated_xdg || { echo "SANDBOX_FAILED" >"$OUT"; exit 1; }
export TMPDIR="$OQA_XDG_ROOT/tmp"; mkdir -p "$TMPDIR"
export PROBE_OUT
cp "$PROBE" "$OQA_XDG_ROOT/probe.js"

mkdir -p "$OQA_PROJ/.opencode"
cat > "$OQA_PROJ/.opencode/opencode.json" <<JSON
{
  "plugin": [
    ["opencode-auto-resume@1.1.10", { "chunkTimeoutMs": 300000 }],
    "oh-my-openagent@4.19.4",
    "file://$OQA_XDG_ROOT/probe.js"
  ]
}
JSON

PORT="$(oqa_free_port)"; PASS="oqa-$RANDOM$RANDOM"; URL="http://127.0.0.1:$PORT"
cd "$OQA_PROJ"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 \
  >"$XDG_STATE_HOME/serve.log" 2>&1 &
SRV=$!
SERVER_READY=no
oqa_wait_http "$URL/global/health" "opencode:$PASS" 90 && SERVER_READY=yes

curl -sN -u "opencode:$PASS" "$URL/event?directory=$OQA_PROJ" >"$OQA_XDG_ROOT/sse.txt" 2>/dev/null &
CURLPID=$!
D=$(( $(date +%s) + 20 )); while [ "$(date +%s)" -lt "$D" ]; do grep -q 'server.connected' "$OQA_XDG_ROOT/sse.txt" 2>/dev/null && break; sleep 0.2; done

curl -s -X POST -u "opencode:$PASS" -H 'Content-Type: application/json' -d '{}' \
  "$URL/session?directory=$OQA_PROJ" >"$OQA_XDG_ROOT/session.json" 2>/dev/null

PROBE_FIRED=no
D=$(( $(date +%s) + 40 ))
while [ "$(date +%s)" -lt "$D" ]; do [ -s "$PROBE_OUT" ] && { PROBE_FIRED=yes; break; }; sleep 0.5; done

kill "$CURLPID" 2>/dev/null
kill -TERM "$SRV" 2>/dev/null; sleep 2; kill -9 "$SRV" 2>/dev/null
AFTER="$(sqlite3 "$REALDB" 'SELECT count(*) FROM session' 2>/dev/null)"
SESSION_EVENTS="$(grep -o '"type":"session[^"]*"' "$OQA_XDG_ROOT/sse.txt" 2>/dev/null | sort -u | tr '\n' ' ')"
SERVE_PLUGIN_ERR="$(grep -is 'oh-my-openagent@4.19.4\|failed to load plugin\|plugin.*error' "$XDG_STATE_HOME/serve.log" | head -3)"

{
  echo "variant: $LABEL"
  echo "opencode: $(opencode --version 2>/dev/null)"
  echo "server_ready: $SERVER_READY"
  echo "config_plugin_array: [tuple(opencode-auto-resume), oh-my-openagent@4.19.4, file://probe.js]"
  echo "sse_session_event_types: $SESSION_EVENTS"
  echo "probe_hook_fired_on_session_created: $PROBE_FIRED"
  echo "real_db: $REALDB"
  echo "real_db_sessions_before: $BEFORE"
  echo "real_db_sessions_after: $AFTER"
  echo "serve_plugin_notes: ${SERVE_PLUGIN_ERR:-none}"
  echo "--- probe decision (fixed functions under real session.created) ---"
  cat "$PROBE_OUT" 2>/dev/null || echo "<probe did not write>"
} >"$OUT"
oqa_cleanup 2>/dev/null || true
cat "$OUT"
