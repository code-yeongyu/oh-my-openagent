#!/usr/bin/env bash
# Isolated opencode QA for the claude-opus-5 Sisyphus prompt variant.
# Proves on REAL opencode (isolated XDG sandbox, fake LLM, no real API calls):
#   1. model openai/claude-opus-5  -> request carries the Opus 5 Sisyphus prompt
#   2. model openai/claude-opus-4-8 -> still carries the Opus 4.8 prompt (no regression)
set -uo pipefail

WORKTREE="/Users/yeongyu/local-workspaces/omo-wt/feature/sisyphus-claude-opus-5-prompt"
QA_DIR="/tmp/opus5-qa"
CAPTURE_DIR="$QA_DIR/captures"
rm -rf "$CAPTURE_DIR"; mkdir -p "$CAPTURE_DIR"

REAL_DB="$HOME/.local/share/opencode/opencode.db"
DB_BEFORE="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session' 2>/dev/null || echo n/a)"
echo "real-db-session-count-before=$DB_BEFORE"

# --- isolated sandbox (mirrors oqa_mk_isolated_xdg) ---
ROOT="$(mktemp -d -t opus5-qa.XXXXXX)"
REAL_HOME="$HOME"
mkdir -p "$ROOT/data" "$ROOT/config" "$ROOT/cache" "$ROOT/state" "$ROOT/home" "$ROOT/proj"
if [ -d "$REAL_HOME/.opencode/bin" ]; then
  mkdir -p "$ROOT/home/.opencode"
  ln -s "$REAL_HOME/.opencode/bin" "$ROOT/home/.opencode/bin"
fi
export HOME="$ROOT/home"
export XDG_DATA_HOME="$ROOT/data"
export XDG_CONFIG_HOME="$ROOT/config"
export XDG_CACHE_HOME="$ROOT/cache"
export XDG_STATE_HOME="$ROOT/state"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
echo "sandbox=$ROOT"

# --- fake LLM ---
CAPTURE_DIR="$CAPTURE_DIR" FAKE_PORT=0 node "$QA_DIR/capture-fake-llm.mjs" >"$QA_DIR/fake-llm.out" 2>&1 &
FAKE_PID=$!
trap 'kill $FAKE_PID 2>/dev/null' EXIT
for _ in $(seq 1 30); do
  PORT="$(grep -o 'listening on [0-9]*' "$QA_DIR/fake-llm.out" 2>/dev/null | awk '{print $3}')"
  [ -n "${PORT:-}" ] && break
  sleep 0.2
done
[ -n "${PORT:-}" ] || { echo "FAIL: fake llm did not start"; exit 1; }
echo "fake-llm-port=$PORT"

# --- sandbox opencode config: worktree plugin from source + fake provider ---
mkdir -p "$XDG_CONFIG_HOME/opencode"
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${WORKTREE}/packages/omo-opencode/src/index.ts"],
  "model": "openai/claude-opus-5",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${PORT}/v1",
        "timeout": 30000
      },
      "models": {
        "claude-opus-5": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } },
        "claude-opus-4-8": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } }
      }
    }
  },
  "permission": { "bash": "allow" }
}
JSONC
printf '%s\n' '{"agents":{"explore":{"model":"openai/claude-opus-5"},"librarian":{"model":"openai/claude-opus-5"}}}' \
  >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json"

cd "$ROOT/proj"
git init -q . 2>/dev/null || true

run_probe() {
  local model="$1" marker="$2"
  echo "--- opencode run agent=sisyphus model=$model ---"
  timeout 120 opencode run </dev/null "$marker reply with anything" --agent sisyphus -m "$model" --format json \
    >"$QA_DIR/run-$marker.json" 2>"$QA_DIR/run-$marker.err" || true
  tail -c 400 "$QA_DIR/run-$marker.json" | head -c 400; echo
}

run_probe "openai/claude-opus-5" "OPUS5PROBE"
run_probe "openai/claude-opus-4-8" "OPUS48PROBE"

kill $FAKE_PID 2>/dev/null; trap - EXIT

echo "=== captured requests ==="
ls -la "$CAPTURE_DIR"

check() {
  local file="$1" needle="$2" expect="$3" label="$4"
  local found=0
  grep -qF "$needle" "$file" && found=1
  if [ "$found" -eq "$expect" ]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label (found=$found expected=$expect)"
    QA_FAIL=1
  fi
}

QA_FAIL=0
OPUS5_CAP="$(ls "$CAPTURE_DIR"/*claude-opus-5.json 2>/dev/null | head -1)"
OPUS48_CAP="$(ls "$CAPTURE_DIR"/*claude-opus-4-8.json 2>/dev/null | head -1)"
echo "opus5-capture=$OPUS5_CAP"
echo "opus48-capture=$OPUS48_CAP"

if [ -n "$OPUS5_CAP" ]; then
  check "$OPUS5_CAP" 'You are **Claude Opus 5**' 1 "opus-5 request carries Opus 5 identity"
  check "$OPUS5_CAP" 'DELEGATE BY DOMAIN AND SIZE, NOT BY DEFAULT' 1 "opus-5 request carries delegation cap"
  check "$OPUS5_CAP" '<tone_preference>' 1 "opus-5 request carries closing tone_preference"
  check "$OPUS5_CAP" 'OVER-VERIFICATION' 1 "opus-5 request carries over-verification counter"
  check "$OPUS5_CAP" 'You are **Claude Opus 4.8**' 0 "opus-5 request does NOT carry 4.8 identity"
else
  echo "FAIL: no capture for claude-opus-5"; QA_FAIL=1
fi

if [ -n "$OPUS48_CAP" ]; then
  check "$OPUS48_CAP" 'You are **Claude Opus 4.8**' 1 "opus-4-8 request still carries 4.8 identity"
  check "$OPUS48_CAP" 'You are **Claude Opus 5**' 0 "opus-4-8 request does NOT carry Opus 5 identity"
  check "$OPUS48_CAP" 'DEFAULT BIAS: DELEGATE' 1 "opus-4-8 request keeps its delegate-bias line"
else
  echo "FAIL: no capture for claude-opus-4-8"; QA_FAIL=1
fi

export HOME="$REAL_HOME"
DB_AFTER="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session' 2>/dev/null || echo n/a)"
echo "real-db-session-count-after=$DB_AFTER"
[ "$DB_BEFORE" = "$DB_AFTER" ] && echo "PASS: real opencode DB untouched" || { echo "FAIL: real DB changed"; QA_FAIL=1; }

rm -rf "$ROOT"
echo "sandbox-removed=$ROOT"
[ "$QA_FAIL" -eq 0 ] && echo "QA_RESULT=PASS" || echo "QA_RESULT=FAIL"
exit "$QA_FAIL"
