#!/usr/bin/env bash
# free-opencode-port.sh — Kill a stale opencode process holding a port and
# optionally clean up tmux panes pointing at the dead server.
#
# Usage: free-opencode-port.sh [--force] [--port N]
#   --force  Skip the confirmation prompt and kill immediately
#   --port N Target port (default: 4096)

set -euo pipefail

PORT=4096
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    --port)  PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Step 1: find the process holding the port ─────────────────────────────────

if ! command -v lsof &>/dev/null; then
  echo "lsof not found — cannot probe port $PORT" >&2
  exit 1
fi

PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)

if [[ -z "$PIDS" ]]; then
  echo "No process found listening on port $PORT."
else
  for PID in $PIDS; do
    # Resolve the executable path to confirm it is an opencode binary
    EXE=""
    if [[ -r /proc/$PID/exe ]]; then
      EXE=$(readlink -f /proc/$PID/exe 2>/dev/null || true)
    elif command -v lsof &>/dev/null; then
      EXE=$(lsof -p "$PID" -Fn 2>/dev/null | grep '^n' | grep -v '(deleted)' | head -1 | cut -c2- || true)
    fi

    IS_OPENCODE=false
    if echo "$EXE" | grep -qi "opencode"; then
      IS_OPENCODE=true
    fi

    echo "PID $PID holds port $PORT (exe: ${EXE:-<unknown>})"

    if [[ "$IS_OPENCODE" == false ]]; then
      echo "  ⚠  Executable does not look like opencode — skipping kill."
      continue
    fi

    if [[ "$FORCE" == false ]]; then
      read -r -p "  Kill PID $PID with SIGKILL? [y/N] " REPLY
      if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
        echo "  Skipped."
        continue
      fi
    fi

    if kill -9 "$PID" 2>/dev/null; then
      echo "  ✓ Killed PID $PID."
    else
      echo "  ✗ Failed to kill PID $PID (already gone or permission denied)." >&2
    fi
  done
fi

# ── Step 2: find stale tmux panes with opencode attach pointing at this port ──

if ! command -v tmux &>/dev/null || ! tmux list-panes -a &>/dev/null 2>&1; then
  # No active tmux server; nothing to clean up
  exit 0
fi

STALE_PANES=$(tmux list-panes -a -F '#{pane_id} #{pane_current_command} #{pane_title}' 2>/dev/null \
  | grep -E "opencode.*:${PORT}|:${PORT}.*opencode" \
  | awk '{print $1}' || true)

if [[ -z "$STALE_PANES" ]]; then
  # Also grep pane contents for "opencode attach http://127.0.0.1:<port>"
  STALE_PANES=$(tmux list-panes -a -F '#{pane_id}' 2>/dev/null | while read -r PANE_ID; do
    CONTENT=$(tmux capture-pane -p -t "$PANE_ID" 2>/dev/null || true)
    if echo "$CONTENT" | grep -qE "opencode attach http://[^[:space:]]*:${PORT}"; then
      echo "$PANE_ID"
    fi
  done || true)
fi

if [[ -z "$STALE_PANES" ]]; then
  echo "No stale tmux panes found for port $PORT."
  exit 0
fi

echo ""
echo "Stale tmux panes referencing port $PORT:"
for PANE_ID in $STALE_PANES; do
  echo "  $PANE_ID"
done

if [[ "$FORCE" == false ]]; then
  read -r -p "Kill these tmux panes? [y/N] " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "Skipped pane cleanup."
    exit 0
  fi
fi

for PANE_ID in $STALE_PANES; do
  if tmux kill-pane -t "$PANE_ID" 2>/dev/null; then
    echo "  ✓ Killed pane $PANE_ID."
  else
    echo "  ✗ Failed to kill pane $PANE_ID (already gone?)." >&2
  fi
done
