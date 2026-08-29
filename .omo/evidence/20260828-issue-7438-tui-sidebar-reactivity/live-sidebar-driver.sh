#!/usr/bin/env bash
set -uo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
. "$ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"

oqa_require opencode tmux sqlite3 bun || exit 1
REAL_DB="$(oqa_db_path)"
BEFORE="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session" 2>/dev/null)"
oqa_mk_isolated_xdg || exit 1

export OPENCODE_CONFIG_DIR="$XDG_CONFIG_HOME/opencode"
mkdir -p "$OPENCODE_CONFIG_DIR"
cat >"$OPENCODE_CONFIG_DIR/opencode.json" <<JSON
{
  "model": "opencode/big-pickle"
}
JSON
cat >"$OPENCODE_CONFIG_DIR/tui.json" <<JSON
{
  "plugin": ["file://$ROOT/dist/tui.js"]
}
JSON

SESSION="oqa_sidebar_${$}_${RANDOM}"
OQA_TMUX_SESSIONS+=("$SESSION")
tmux new-session -d -s "$SESSION" -x 200 -y 50
tmux send-keys -t "$SESSION" \
  "HOME='$HOME' OPENCODE_TEST_HOME='$OPENCODE_TEST_HOME' XDG_DATA_HOME='$XDG_DATA_HOME' XDG_CONFIG_HOME='$XDG_CONFIG_HOME' XDG_CACHE_HOME='$XDG_CACHE_HOME' XDG_STATE_HOME='$XDG_STATE_HOME' OPENCODE_CONFIG_DIR='$OPENCODE_CONFIG_DIR' OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 opencode '$OQA_PROJ'" Enter

wait_for_text() {
  local needle="$1" deadline=$((SECONDS + 30)) pane
  while [ "$SECONDS" -lt "$deadline" ]; do
    pane="$(tmux capture-pane -t "$SESSION" -p -J 2>/dev/null)"
    printf '%s' "$pane" | grep -q "$needle" && return 0
    sleep 0.2
  done
  return 1
}

wait_without_text() {
  local needle="$1" deadline=$((SECONDS + 30)) pane
  while [ "$SECONDS" -lt "$deadline" ]; do
    pane="$(tmux capture-pane -t "$SESSION" -p -J 2>/dev/null)"
    if ! printf '%s' "$pane" | grep -q "$needle"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

write_snapshot() {
  local state="$1"
  ROOT="$ROOT" PROJECT="$OQA_PROJ" STATE="$state" bun -e '
    import { MIRROR_SCHEMA_VERSION } from "./packages/omo-opencode/src/features/tui-sidebar/constants.ts"
    import { writeMirror } from "./packages/omo-opencode/src/features/tui-sidebar/mirror-io.ts"
    const activeAgents = process.env.STATE === "active"
      ? [{ name: "qa-live-agent", status: "busy" }]
      : []
    writeMirror(process.env.PROJECT, {
      version: MIRROR_SCHEMA_VERSION,
      projectDir: process.env.PROJECT,
      updatedAt: Date.now(),
      activeAgents,
      jobBoard: [],
      loop: null,
    })
  '
}

wait_for_text "Ask anything" || {
  printf 'ERROR=tui_home_not_ready\n'
  exit 1
}
tmux send-keys -t "$SESSION" "open sidebar qa" Enter
wait_for_text "Models" || {
  printf 'ERROR=sidebar_not_mounted\n'
  exit 1
}

write_snapshot active
wait_for_text "qa-live-agent" || {
  printf 'ERROR=active_transition_not_rendered\n'
  exit 1
}
printf 'ACTIVE_TRANSITION=PASS\n'

write_snapshot idle
wait_without_text "qa-live-agent" || {
  printf 'ERROR=idle_transition_not_rendered\n'
  exit 1
}
wait_for_text "Models" || {
  printf 'ERROR=idle_sidebar_missing\n'
  exit 1
}
printf 'IDLE_TRANSITION=PASS\n'

tmux kill-session -t "$SESSION" 2>/dev/null || true
AFTER="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session" 2>/dev/null)"
if [ "$BEFORE" != "$AFTER" ]; then
  printf 'ISOLATION=FAIL:%s:%s\n' "$BEFORE" "$AFTER"
  exit 1
fi
printf 'ISOLATION=PASS:%s\n' "$BEFORE"
