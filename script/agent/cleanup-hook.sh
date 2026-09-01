#!/usr/bin/env bash
# Non-blocking Claude Code SessionEnd launcher for cleanup.sh.
#
# Claude may cancel shutdown hooks while the session is closing. Keep this hook
# tiny and best-effort, then let cleanup.sh do strict synchronous work outside
# the hook process.
set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CLEANUP_SCRIPT="$PROJECT_DIR/script/agent/cleanup.sh"
LOG_DIR="${TMPDIR:-/tmp}"

case "$LOG_DIR" in
  *..* | "")
    LOG_DIR="/tmp"
    ;;
  /tmp | /tmp/* | /private/tmp | /private/tmp/* | /var/folders/*)
    ;;
  *)
    LOG_DIR="/tmp"
    ;;
esac

LOG_FILE="${LOG_DIR%/}/oh-my-openagent-cleanup.log"

if [ ! -f "$CLEANUP_SCRIPT" ]; then
  printf '[cleanup-hook] missing cleanup script: %s\n' "$CLEANUP_SCRIPT" >&2
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

if [ "${OMO_AGENT_CLEANUP_SYNC:-0}" = "1" ]; then
  bash "$CLEANUP_SCRIPT" >>"$LOG_FILE" 2>&1 || true
  exit 0
fi

if command -v nohup >/dev/null 2>&1; then
  nohup bash "$CLEANUP_SCRIPT" >>"$LOG_FILE" 2>&1 </dev/null &
else
  bash "$CLEANUP_SCRIPT" >>"$LOG_FILE" 2>&1 </dev/null &
fi

disown "$!" 2>/dev/null || true
exit 0
