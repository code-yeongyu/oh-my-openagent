#!/usr/bin/env bash
set -euo pipefail
export REPO_ROOT="$(git rev-parse --show-toplevel)"
EV="$REPO_ROOT/.omo/evidence/20260908-lcx-astra"
source "$REPO_ROOT/.agents/skills/codex-qa/scripts/lib/common.sh"
cqa_guard_real_home
printf 'REAL_HOME_SHASUM_BEFORE=%s\n' "$CQA_REAL_HOME_SUM"
finish() {
  local rc=$?
  cqa_assert_real_home_unchanged || rc=1
  printf 'REAL_HOME_SHASUM_AFTER=%s\n' "$(shasum "$HOME/.codex/config.toml" | awk '{print $1}')"
  local roots=("${CQA_TMPDIRS[@]}") d
  cqa_cleanup
  for d in "${roots[@]}"; do
    if [ ! -e "$d" ]; then printf 'REMOVED=%s\n' "$d"; else printf 'CLEANUP_FAILED=%s\n' "$d"; rc=1; fi
  done
  exit "$rc"
}
trap finish EXIT
cqa_mk_isolated_home
outer="$CQA_HOME_ROOT"
mkdir -p "$outer/home" "$outer/xdg-config" "$outer/xdg-data" "$outer/xdg-cache" "$outer/xdg-state"
run_skill() {
  HOME="$outer/home" XDG_CONFIG_HOME="$outer/xdg-config" XDG_DATA_HOME="$outer/xdg-data" \
    XDG_CACHE_HOME="$outer/xdg-cache" XDG_STATE_HOME="$outer/xdg-state" \
    CODEX_BIN=/opt/homebrew/bin/codex bash "$REPO_ROOT/.agents/skills/codex-qa/scripts/install-verify.sh" "$@"
}
if [ "${1:-}" != --resume ]; then
  printf '\nCOMMAND: scripts/install-verify.sh --self-test (isolated HOME as well as CODEX_HOME)\n'
  run_skill --self-test 2>&1 | tee "$EV/task-7-install-self-test.log"
fi
printf '\nCOMMAND: scripts/install-verify.sh --keep (fresh real install)\n'
run_skill --keep 2>&1 | tee -a "$EV/task-7-install-fresh.log"
fresh="$(awk '/^kept isolated home: /{home=$4} END {print home}' "$EV/task-7-install-fresh.log")"
test -n "$fresh" && test -d "$fresh"
CQA_TMPDIRS+=("$(dirname "$fresh")")
bun "$EV/task-7-install-assertions.ts" fresh "$fresh" "$REPO_ROOT" "$EV"
cp "$(dirname "$fresh")/install.log" "$EV/task-7-fresh-installer.log"

for mode in legacy preservation agent-preservation malformed; do
  cqa_mk_isolated_home
  mkdir -p "$CQA_HOME_ROOT/home" "$CQA_HOME_ROOT/xdg-config" "$CQA_HOME_ROOT/xdg-data" "$CQA_HOME_ROOT/xdg-cache" "$CQA_HOME_ROOT/xdg-state"
  case "$mode" in
    legacy)
      printf 'model = "gpt-5.6-sol"\nmodel_context_window = 650000\nmodel_reasoning_effort = "high"\nplan_mode_reasoning_effort = "xhigh"\n[features.multi_agent_v2]\nmax_concurrent_threads_per_session = 1000\n[agents]\nmax_threads = 1000\n' > "$CODEX_HOME/config.toml" ;;
    preservation)
      printf 'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"\n[features.multi_agent_v2]\nmax_concurrent_threads_per_session = 4\n' > "$CODEX_HOME/config.toml" ;;
    agent-preservation)
      mkdir -p "$CODEX_HOME/agents"
      printf '[agents.explorer]\nconfig_file = "./agents/explorer.toml"\n' > "$CODEX_HOME/config.toml"
      printf 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "xhigh"\n' > "$CODEX_HOME/agents/explorer.toml" ;;
    malformed)
      printf 'model = "unterminated\n' > "$CODEX_HOME/config.toml" ;;
  esac
  cp "$CODEX_HOME/config.toml" "$EV/task-7-${mode}-seed.toml"
  printf '\nINSTALL_MODE=%s CODEX_HOME=%s HOME=%s\n' "$mode" "$CODEX_HOME" "$CQA_HOME_ROOT/home"
  rc=0
  HOME="$CQA_HOME_ROOT/home" XDG_CONFIG_HOME="$CQA_HOME_ROOT/xdg-config" XDG_DATA_HOME="$CQA_HOME_ROOT/xdg-data" \
    XDG_CACHE_HOME="$CQA_HOME_ROOT/xdg-cache" XDG_STATE_HOME="$CQA_HOME_ROOT/xdg-state" \
    cqa_install_local_omo || rc=$?
  cp "$CQA_HOME_ROOT/install.log" "$EV/task-7-${mode}-installer.log"
  printf 'INSTALL_EXIT=%s\n' "$rc"
  if [ "$mode" = malformed ]; then
    cp "$CODEX_HOME/config.toml" "$EV/task-7-malformed-after.toml"
    printf 'MALFORMED_BEFORE_SHA1=%s\n' "$(shasum "$EV/task-7-malformed-seed.toml" | awk '{print $1}')"
    printf 'MALFORMED_AFTER_SHA1=%s\n' "$(shasum "$CODEX_HOME/config.toml" | awk '{print $1}')"
    test "$rc" -ne 0
    cmp "$EV/task-7-malformed-seed.toml" "$CODEX_HOME/config.toml"
    printf 'MALFORMED_REJECTED_UNCHANGED=PASS\n'
  else
    test "$rc" -eq 0
    bun "$EV/task-7-install-assertions.ts" "$mode" "$CODEX_HOME" "$REPO_ROOT" "$EV"
  fi
  cqa_assert_real_home_unchanged
done
printf '\nINSTALL_QA=PASS\n'
