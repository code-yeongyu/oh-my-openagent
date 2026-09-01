#!/usr/bin/env bash
# Run one diagnostic scenario in an isolated sandbox, strictly on opencode-go models.
# usage: run-task.sh <task-dir> <label> [config-file]
# env: EVIDENCE_DIR (default <repo>/.omo/evidence/diag-harness)
set -euo pipefail
TASK_DIR="$1"
LABEL="$2"
CONFIG_FILE="${3:-}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SELF_DIR/../.." && pwd)"
if [ -z "$CONFIG_FILE" ]; then CONFIG_FILE="$SELF_DIR/sandbox-omo-config.jsonc"; fi
PROJECT_DIR="$TASK_DIR/project"
EVIDENCE="${EVIDENCE_DIR:-$REPO/.omo/evidence/diag-harness}"

source "$REPO/script/agent/qa-sandbox.sh" >/dev/null
mkdir -p "$XDG_DATA_HOME/opencode" "$XDG_CONFIG_HOME/opencode"
cp ~/.local/share/opencode/auth.json "$XDG_DATA_HOME/opencode/auth.json"
cp ~/.config/opencode/opencode.json "$XDG_CONFIG_HOME/opencode/opencode.json"
cp "$CONFIG_FILE" "$XDG_CONFIG_HOME/opencode/oh-my-openagent.jsonc"

mkdir -p "$EVIDENCE"
echo "$OMO_QA_ROOT" > "$EVIDENCE/$LABEL.sandbox-root.txt"

echo "[run-task] $LABEL start $(date -u +%H:%M:%S)"
opencode run --format json -m opencode-go/deepseek-v4-flash \
  --dir "$PROJECT_DIR" --title "diag-$LABEL" \
  "$(cat "$TASK_DIR/prompt.md")" \
  > "$EVIDENCE/$LABEL.jsonl" 2> "$EVIDENCE/$LABEL.err"
echo "[run-task] $LABEL end $(date -u +%H:%M:%S) exit=$?"
