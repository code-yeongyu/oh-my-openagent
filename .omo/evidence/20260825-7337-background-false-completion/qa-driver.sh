#!/usr/bin/env bash
# opencode-qa driver for #7337 live lane.
# Isolated XDG sandbox + fake OpenAI LLM + real `opencode serve` with the
# worktree plugin loaded. Never touches the real ~/.local/share/opencode.
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(GIT_MASTER=1 git -C "$EVIDENCE_DIR" rev-parse --show-toplevel)"
SKILL_LIB="$REPO_ROOT/.agents/skills/opencode-qa/scripts/lib"

REAL_HOME="$HOME"
REAL_DB="$REAL_HOME/.local/share/opencode/opencode.db"

log() { printf '[qa7337] %s\n' "$*"; }

cleanup() {
  if [ -n "${SERVE_PID:-}" ]; then kill "$SERVE_PID" 2>/dev/null; sleep 0.3; kill -9 "$SERVE_PID" 2>/dev/null || true; fi
  if [ -n "${FAKE_PID:-}" ]; then kill "$FAKE_PID" 2>/dev/null; sleep 0.3; kill -9 "$FAKE_PID" 2>/dev/null || true; fi
  if [ -n "${XDG_ROOT:-}" ] && [ -d "${XDG_ROOT:-}" ]; then rm -rf "$XDG_ROOT"; fi
}
trap cleanup EXIT

# --- isolation proof: see the dedicated block at the end of this script -------

# --- isolated sandbox ---------------------------------------------------------
XDG_ROOT="$(mktemp -d -t oqa7337.XXXXXX)"
mkdir -p "$XDG_ROOT/data" "$XDG_ROOT/config" "$XDG_ROOT/cache" "$XDG_ROOT/state" "$XDG_ROOT/home" "$XDG_ROOT/proj"
export HOME="$XDG_ROOT/home"
export XDG_DATA_HOME="$XDG_ROOT/data"
export XDG_CONFIG_HOME="$XDG_ROOT/config"
export XDG_CACHE_HOME="$XDG_ROOT/cache"
export XDG_STATE_HOME="$XDG_ROOT/state"
export OQA_PROJ="$XDG_ROOT/proj"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
log "sandbox: $XDG_ROOT"

# --- fake LLM -----------------------------------------------------------------
FAKE_LOG="$XDG_ROOT/state/fake-llm.log"
bun run --bun "$SKILL_LIB/fake-openai-server.mjs" >"$FAKE_LOG" 2>&1 &
FAKE_PID=$!
FAKE_PORT=""
for _ in $(seq 1 50); do
  if curl -sf --max-time 3 "http://127.0.0.1:${FAKE_OPENAI_PORT:-0}/health" >/dev/null 2>&1; then break; fi
  # server writes its chosen port to stdout when FAKE_OPENAI_PORT is unset
  FAKE_PORT="$(grep -oE 'listening on [0-9]+' "$FAKE_LOG" 2>/dev/null | grep -oE '[0-9]+' | tail -1)"
  [ -n "$FAKE_PORT" ] && curl -sf --max-time 3 "http://127.0.0.1:$FAKE_PORT/health" >/dev/null 2>&1 && break
  sleep 0.2
done
if [ -z "$FAKE_PORT" ]; then
  # fall back: parse any URL-ish port from the log
  FAKE_PORT="$(grep -oE '127\.0\.0\.1:[0-9]+' "$FAKE_LOG" | grep -oE '[0-9]+$' | tail -1)"
fi
[ -n "$FAKE_PORT" ] || { log "FAIL: fake LLM did not report a port"; cat "$FAKE_LOG"; exit 1; }
log "fake LLM on 127.0.0.1:$FAKE_PORT"

# --- sandbox configs (mirror serve-wake-split-probe.sh) ------------------------
mkdir -p "$XDG_CONFIG_HOME/opencode"
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${REPO_ROOT}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${FAKE_PORT}/v1",
        "timeout": 30000
      },
      "models": {
        "gpt-fake": {
          "tool_call": true,
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  },
  "permission": { "bash": "allow", "call_omo_agent": "allow" }
}
JSONC
printf '%s\n' '{"agents":{"explore":{"model":"openai/gpt-fake"},"librarian":{"model":"openai/gpt-fake"}}}' \
  >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json"
log "sandbox configs written"

# --- real opencode serve -------------------------------------------------------
PORT="$(bun -e 'const s=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}});console.log(s.port);s.stop()')"
PASS="oqa7337-$RANDOM$RANDOM"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 \
  >"$XDG_STATE_HOME/serve.log" 2>&1 &
SERVE_PID=$!
export OQA_SERVER_URL="http://127.0.0.1:$PORT"
export OQA_SERVER_PASS="$PASS"
ready=0
for _ in $(seq 1 150); do
  if curl -sf --max-time 3 -u "opencode:$PASS" "$OQA_SERVER_URL/global/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.2
done
[ "$ready" = "1" ] || { log "FAIL: opencode serve did not become healthy"; cat "$XDG_STATE_HOME/serve.log"; exit 1; }
log "opencode serve healthy at $OQA_SERVER_URL (plugin: worktree src)"

# --- run the lane --------------------------------------------------------------
cd "$REPO_ROOT"
log "running qa lane (bounded at 240s)..."
exit_code=0
IDS_FILE="$EVIDENCE_DIR/qa-session-ids.json"
rm -f "$IDS_FILE"
OQA_SERVER_URL="$OQA_SERVER_URL" OQA_SERVER_PASS="$PASS" OQA_PROJ="$OQA_PROJ" QA_SESSION_IDS_FILE="$IDS_FILE" \
  timeout 240 bun run --bun "$EVIDENCE_DIR/qa-lane.ts" >"$EVIDENCE_DIR/live-lane-output.log" 2>&1
exit_code=$?
cat "$EVIDENCE_DIR/live-lane-output.log"

if [ ! -s "$IDS_FILE" ]; then
  log "FAIL: lane recorded no session ids (lane crashed before first session create)"
  exit 1
fi

# --- isolation proof: QA session IDs must exist ONLY in the sandbox DB ---------
# The real DB is a live moving target (the host opencode writes constantly), so
# fingerprint comparison is meaningless. Instead: read both DBs read-only and
# assert none of the QA-created session ids leaked into the real one.
IDS_FILE="$EVIDENCE_DIR/qa-session-ids.json"
ISOLATION="$EVIDENCE_DIR/isolation-proof.txt"
REAL_DB="$REAL_HOME/.local/share/opencode/opencode.db"
SANDBOX_DB="$XDG_DATA_HOME/opencode/opencode.db"
bun -e '
const { Database } = await import("bun:sqlite")
const ids = JSON.parse(await Bun.file(process.argv[1]).text()) as string[]
if (ids.length === 0) { console.log("no qa session ids recorded"); process.exit(1) }
const placeholders = ids.map(() => "?").join(",")
let realCount = -1
try {
  const realDb = new Database(process.argv[2], { readonly: true })
  realCount = realDb.query(`SELECT count(*) AS c FROM session WHERE id IN (${placeholders})`).get(...ids)?.c ?? -1
  realDb.close()
} catch (error) {
  console.log(`real db unreadable (readonly): ${String(error)}`)
}
const sandboxDb = new Database(process.argv[3], { readonly: true })
const sandboxCount = sandboxDb.query(`SELECT count(*) AS c FROM session WHERE id IN (${placeholders})`).get(...ids)?.c ?? -1
sandboxDb.close()
console.log(`qa sessions in REAL db: ${realCount} (expected 0)`)
console.log(`qa sessions in SANDBOX db: ${sandboxCount} (expected ${ids.length})`)
if (realCount !== 0 || sandboxCount !== ids.length) process.exit(1)
console.log("ISOLATION VERIFIED")
' "$IDS_FILE" "$REAL_DB" "$SANDBOX_DB" >"$ISOLATION" 2>&1
iso_rc=$?
cat "$ISOLATION"
printf '%s\n' \
  'real db path: $REAL_HOME/.local/share/opencode/opencode.db' \
  'sandbox db path: $QA_SANDBOX/data/opencode/opencode.db' \
  'sandbox xdg root: $QA_SANDBOX' >>"$ISOLATION"
[ "$iso_rc" = "0" ] || exit_code=1

log "driver exit code: $exit_code"
exit "$exit_code"
