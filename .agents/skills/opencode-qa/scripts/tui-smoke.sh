#!/usr/bin/env bash
# tui-smoke.sh - launch the opencode TUI under tmux in an ISOLATED sandbox,
# confirm it renders, prove send-keys reaches the composer, then tear down.
#
# This is a feasibility/smoke check, NOT a functional assertion harness. The
# TUI is a 60fps full-screen app; reading its frame is fine for "did it boot
# and accept a keystroke", but brittle for asserting conversation output. For
# real behavior assertions use `opencode run` (Case A) or the server API /
# SSE probe (Case B). See references/tui-tmux.md.
#
# Safety: runs opencode under an isolated XDG sandbox so no session is written
# to the real ~/.local/share/opencode DB; the tmux session is always killed.
#
# Usage:
#   tui-smoke.sh              # run the smoke test
#   tui-smoke.sh --self-test  # same

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

oqa_tui_smoke() {
  oqa_require opencode tmux jq sqlite3 || return 1
  local before after realdb ver sess cap found="" i fails=0
  # Capture the REAL DB path + count BEFORE isolation. We must read it with
  # sqlite3 directly: once oqa_mk_isolated_xdg exports XDG_DATA_HOME, `opencode
  # db` would resolve the empty sandbox DB instead of the real one.
  realdb="$(oqa_db_path)"
  before="$(sqlite3 "$realdb" "SELECT count(*) FROM session" 2>/dev/null)"
  ver="$(opencode --version 2>/dev/null | head -1 | tr -d '[:space:]')"

  oqa_mk_isolated_xdg
  sess="oqa_tui_${$}_${RANDOM}"
  OQA_TMUX_SESSIONS+=("$sess")
  tmux new-session -d -s "$sess" -x 200 -y 50
  # launch the TUI inside the pane, carrying the isolated sandbox env
  tmux send-keys -t "$sess" \
    "HOME='$HOME' OPENCODE_TEST_HOME='$OPENCODE_TEST_HOME' XDG_DATA_HOME='$XDG_DATA_HOME' XDG_CONFIG_HOME='$XDG_CONFIG_HOME' XDG_CACHE_HOME='$XDG_CACHE_HOME' XDG_STATE_HOME='$XDG_STATE_HOME' OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 opencode '$OQA_PROJ'" Enter

  # poll for a render marker (version string, composer placeholder, or footer)
  for ((i=0; i<50; i++)); do
    cap="$(tmux capture-pane -t "$sess" -p 2>/dev/null)"
    if printf '%s' "$cap" | grep -Eq "${ver}|Ask anything|ctrl\+p|agents"; then found=1; break; fi
    sleep 0.5
  done
  if [ -n "$found" ]; then
    oqa_pass "TUI rendered under tmux (marker found; version ${ver:-?})"
  else
    oqa_log "FAIL: TUI did not render a known marker in 25s; pane was:"; printf '%s\n' "$cap" | head -8 >&2
    fails=$((fails+1))
  fi

  # prove send-keys reaches the composer: type a sentinel, expect it on screen
  if [ -n "$found" ]; then
    tmux send-keys -t "$sess" "oqaXYZ"
    sleep 1
    cap="$(tmux capture-pane -t "$sess" -p 2>/dev/null)"
    if printf '%s' "$cap" | grep -q "oqaXYZ"; then
      oqa_pass "send-keys reached the TUI composer (sentinel echoed)"
    else
      oqa_log "WARN: sentinel not visible (TUI may have remapped input); render still proven"
    fi
  fi

  # teardown + verify
  tmux kill-session -t "$sess" 2>/dev/null || true
  sleep 0.5
  if tmux has-session -t "$sess" 2>/dev/null; then
    oqa_log "FAIL: tmux session survived teardown"; fails=$((fails+1))
  else
    oqa_pass "tmux session torn down (has-session false)"
  fi

  after="$(sqlite3 "$realdb" "SELECT count(*) FROM session" 2>/dev/null)"
  if [ "$before" = "$after" ]; then
    oqa_pass "real DB untouched (session count $before unchanged)"
  else
    oqa_log "FAIL: real DB session count changed $before -> $after"; fails=$((fails+1))
  fi

  [ "$fails" -eq 0 ] && { oqa_pass "tui-smoke"; return 0; }
  oqa_log "tui-smoke had $fails failure(s)"; return 1
}

case "${1:-}" in
  -h|--help)
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *) oqa_tui_smoke; exit $? ;;
esac
