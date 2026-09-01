#!/usr/bin/env bash
# tui-smoke.sh - boot the real codex TUI under tmux in an ISOLATED CODEX_HOME
# (+ local mock model) and capture the rendered pane. SMOKE only: it proves the
# TUI launches, renders, and stays alive - it does NOT assert turn behavior
# (use app-server-drive.sh for that). The captured pane is the artifact.
#
#   --self-test       boot bare TUI, assert it renders + survives, capture pane
#   --plugin          install local omo first, then boot (proves the plugin
#                     loads in the real TUI without crashing it)
#   --seconds <n>     dwell time before capture (default 5)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

cqa_tui_smoke() {
  local plugin="$1" dwell="$2"
  cqa_require codex tmux node || return 1
  cqa_guard_real_home
  cqa_mk_isolated_home
  if [ "$plugin" = "1" ]; then
    cqa_log "installing local omo into $CODEX_HOME ..."
    cqa_install_local_omo || { tail -20 "$CQA_HOME_ROOT/install.log" >&2; return 1; }
  fi
  cqa_start_mock || return 1
  local bin sess cap launch exitf errf; bin="$(cqa_codex_bin)"
  sess="cqa-tui-$$"; CQA_TMUX_SESSIONS+=("$sess")
  cap="$CQA_HOME_ROOT/tui-pane.txt"
  launch="$CQA_HOME_ROOT/tui-launch.sh"
  exitf="$CQA_HOME_ROOT/tui-exit.txt"
  errf="$CQA_HOME_ROOT/tui-stderr.txt"
  cat > "$launch" <<LAUNCH
#!/usr/bin/env bash
export CODEX_HOME="$CODEX_HOME"
cd "$QA_CWD" || exit 97
"$bin" -c model=mock-model -c model_provider=mock_provider \
  -c model_providers.mock_provider.name="codex-qa mock" \
  -c model_providers.mock_provider.base_url=http://127.0.0.1:$MOCK_PORT/v1 \
  -c model_providers.mock_provider.wire_api=responses \
  -c approval_policy=never -c sandbox_mode=read-only 2>"$errf"
echo "\$?" > "$exitf"
sleep 600
LAUNCH
  chmod +x "$launch"
  tmux new-session -d -s "$sess" -x 200 -y 50 "bash '$launch'"
  sleep "$dwell"
  tmux capture-pane -t "$sess" -p -S - > "$cap" 2>/dev/null
  tmux send-keys -t "$sess" C-c 2>/dev/null; sleep 0.3
  tmux kill-session -t "$sess" 2>/dev/null
  cqa_assert_real_home_unchanged || return 1
  if [ -f "$exitf" ]; then
    cqa_log "codex exited during boot (code $(cat "$exitf")); stderr:"; sed -n '1,20p' "$errf" >&2
    return "$(cqa_fail "codex TUI did not stay up")"
  fi
  cqa_log "captured pane -> $cap"; sed -n '1,40p' "$cap" >&2
  if [ ! -s "$cap" ]; then cqa_fail "TUI pane was empty (did not render)"; return 1; fi
  if grep -qiE 'panic|panicked|fatal' "$cap"; then cqa_fail "TUI crashed (panic/fatal in pane)"; return 1; fi
  cqa_pass "codex TUI booted, rendered, and survived ${dwell}s (no early exit)"; return 0
}

MODE=0; DWELL=5
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test) MODE=0; shift ;;
    --plugin) MODE=1; shift ;;
    --seconds) DWELL="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) cqa_log "unknown option: $1"; shift ;;
  esac
done
cqa_tui_smoke "$MODE" "$DWELL"
exit $?
