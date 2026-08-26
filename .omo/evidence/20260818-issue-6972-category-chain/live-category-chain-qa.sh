#!/usr/bin/env bash
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="$REPO/.omo/evidence/20260818-issue-6972-category-chain/live-category-chain-qa.txt"
REAL_HOME="$HOME"
SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6972-qa-XXXXXX")"
trap 'rm -rf "$SBX"' EXIT

count_sessions() {
  opencode db "SELECT count(*) FROM session" --format json 2>/dev/null | grep -o '[0-9]\+' | head -1
}

BEFORE_COUNT="$(count_sessions)"
mkdir -p "$SBX/home" "$SBX/data/opencode" "$SBX/config/opencode" "$SBX/cache" "$SBX/state" "$SBX/tmp" "$SBX/proj/.omo"
if [ -f "$REAL_HOME/.local/share/opencode/auth.json" ]; then
  cp "$REAL_HOME/.local/share/opencode/auth.json" "$SBX/data/opencode/auth.json"
fi

cat > "$SBX/config/opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO/dist/index.js"]
}
JSON

cat > "$SBX/proj/.omo/omo.jsonc" <<'JSON'
{
  "categories": {
    "verifier": {
      "description": "Issue 6972 live category chain probe",
      "models": [
        "opencode/issue-6972-model-does-not-exist",
        "opencode/deepseek-v4-flash-free"
      ]
    }
  }
}
JSON

sandbox_env() {
  export HOME="$SBX/home"
  export USERPROFILE="$SBX/home"
  export XDG_DATA_HOME="$SBX/data"
  export XDG_CONFIG_HOME="$SBX/config"
  export XDG_CACHE_HOME="$SBX/cache"
  export XDG_STATE_HOME="$SBX/state"
  export TMPDIR="$SBX/tmp"
  export TEMP="$SBX/tmp"
  export TMP="$SBX/tmp"
  export OPENCODE_DISABLE_AUTOUPDATE=1
}

PROMPT='Call the task tool exactly once. Use category "verifier", load_skills [], run_in_background false, description "Issue 6972 child probe", and prompt "Reply with exactly CHILD_OK". After the tool returns, reply with exactly PARENT_OK.'
( sandbox_env && cd "$SBX/proj" && opencode run "$PROMPT" --model opencode/deepseek-v4-flash-free --format json ) > "$SBX/run.json" 2> "$SBX/run.err"
RUN_EXIT=$?
AFTER_COUNT="$(count_sessions)"

TASK_CALLS="$(grep -c '"tool":"task"' "$SBX/run.json" 2>/dev/null || true)"
CHILD_OK="$(grep -c 'CHILD_OK' "$SBX/run.json" 2>/dev/null || true)"
PARENT_OK="$(grep -c 'PARENT_OK' "$SBX/run.json" 2>/dev/null || true)"
SELECTED_MODEL_LOGS="$(grep -c 'opencode/deepseek-v4-flash-free' "$SBX/tmp/oh-my-opencode.log" 2>/dev/null || true)"
MISSING_MODEL_ERRORS="$(grep -c 'ProviderModelNotFoundError\|issue-6972-model-does-not-exist' "$SBX/run.err" 2>/dev/null || true)"

OK=1
[ "$RUN_EXIT" -eq 0 ] || OK=0
[ "$TASK_CALLS" -ge 1 ] || OK=0
[ "$CHILD_OK" -ge 1 ] || OK=0
[ "$PARENT_OK" -ge 1 ] || OK=0
[ "$SELECTED_MODEL_LOGS" -ge 1 ] || OK=0
[ "$MISSING_MODEL_ERRORS" -eq 0 ] || OK=0
[ "$BEFORE_COUNT" = "$AFTER_COUNT" ] || OK=0

{
  echo "OpenCode real-harness QA for issue #6972"
  echo "command: opencode run <task-tool probe> --model opencode/deepseek-v4-flash-free --format json"
  echo "plugin: $REPO/dist/index.js"
  echo "configured chain: opencode/issue-6972-model-does-not-exist -> opencode/deepseek-v4-flash-free"
  echo "run exit: $RUN_EXIT"
  echo "task tool events: $TASK_CALLS"
  echo "CHILD_OK observations: $CHILD_OK"
  echo "PARENT_OK observations: $PARENT_OK"
  echo "selected available model log observations: $SELECTED_MODEL_LOGS"
  echo "missing-model errors: $MISSING_MODEL_ERRORS"
  echo "real DB sessions before: $BEFORE_COUNT"
  echo "real DB sessions after: $AFTER_COUNT"
  echo "real DB unchanged: $([ "$BEFORE_COUNT" = "$AFTER_COUNT" ] && echo true || echo false)"
  echo "stderr tail:"
  tail -10 "$SBX/run.err" | sed 's/^/  /'
  echo "result: $([ "$OK" -eq 1 ] && echo PASS || echo FAIL)"
} > "$OUT"

cat "$OUT"
[ "$OK" -eq 1 ]
