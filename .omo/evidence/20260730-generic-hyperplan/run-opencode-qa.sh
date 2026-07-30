#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE="$REPO_ROOT/.omo/evidence/20260730-generic-hyperplan"
REAL_DB="${HOME}/.local/share/opencode/opencode.db"
BEFORE="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session;' 2>/dev/null || printf '0')"
ROOT="$(mktemp -d -t hyperplan-opencode.XXXXXX)"
MODEL_PID=""

cleanup() {
  if [ -n "$MODEL_PID" ]; then
    kill "$MODEL_PID" 2>/dev/null || true
    wait "$MODEL_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

mkdir -p "$ROOT"/{home,data,config,cache,state,project} "$ROOT/config/opencode"
ln -s "$REPO_ROOT/.agents" "$ROOT/project/.agents"
if [ -d "$HOME/.opencode/bin" ]; then
  mkdir -p "$ROOT/home/.opencode"
  ln -s "$HOME/.opencode/bin" "$ROOT/home/.opencode/bin"
fi

export HOME="$ROOT/home"
export OPENCODE_TEST_HOME="$ROOT/home"
export XDG_DATA_HOME="$ROOT/data"
export XDG_CONFIG_HOME="$ROOT/config"
export XDG_CACHE_HOME="$ROOT/cache"
export XDG_STATE_HOME="$ROOT/state"
export OPENCODE_CONFIG_DIR="$ROOT/config/opencode"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1

FAKE_HYPERPLAN_LOG="$EVIDENCE/opencode-fake-model.log" \
  bun "$EVIDENCE/fake-hyperplan-model.mjs" >"$ROOT/model.port" 2>"$EVIDENCE/opencode-fake-model.stderr" &
MODEL_PID=$!

for _ in $(seq 1 100); do
  [ -s "$ROOT/model.port" ] && break
  sleep 0.1
done
MODEL_PORT="$(head -1 "$ROOT/model.port")"
test -n "$MODEL_PORT"

cat >"$OPENCODE_CONFIG_DIR/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${REPO_ROOT}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${MODEL_PORT}/v1",
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
  "permission": {
    "skill": "allow"
  }
}
JSONC

opencode debug skill >"$EVIDENCE/opencode-debug-skill.json" 2>"$EVIDENCE/opencode-debug-skill.stderr"
(
  cd "$ROOT/project"
  opencode run --format json \
    "Load the hyperplan skill using the skill tool, then report the model's verification marker. Do not call team tools." \
    >"$EVIDENCE/opencode-run.jsonl" \
    2>"$EVIDENCE/opencode-run.stderr"
)

AFTER="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session;' 2>/dev/null || printf '0')"
{
  printf 'real_db=%s\n' "$REAL_DB"
  printf 'before=%s\n' "$BEFORE"
  printf 'after=%s\n' "$AFTER"
  printf 'unchanged=%s\n' "$([ "$BEFORE" = "$AFTER" ] && printf true || printf false)"
  printf 'sandbox_removed_on_exit=true\n'
} >"$EVIDENCE/opencode-isolation.txt"

rg -q '"name": "hyperplan"' "$EVIDENCE/opencode-debug-skill.json"
rg -q 'Harness-neutral adversarial multi-agent planning skill' "$EVIDENCE/opencode-debug-skill.json"
rg -q '"tool":"skill"|"name":"skill"|OPENCODE_HYPERPLAN_SKILL_OK' "$EVIDENCE/opencode-run.jsonl"
rg -q 'OPENCODE_HYPERPLAN_SKILL_OK' "$EVIDENCE/opencode-run.jsonl"
test "$BEFORE" = "$AFTER"

printf 'PASS: OpenCode discovered and loaded generic hyperplan in isolated XDG sandbox\n'
