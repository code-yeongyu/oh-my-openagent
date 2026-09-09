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
  local root="$CQA_HOME_ROOT"
  cqa_cleanup
  if [ ! -e "$root" ]; then printf 'REMOVED=%s\n' "$root"; else printf 'CLEANUP_FAILED=%s\n' "$root"; rc=1; fi
  exit "$rc"
}
trap finish EXIT
cqa_mk_isolated_home
mkdir -p "$CQA_HOME_ROOT/home" "$CQA_HOME_ROOT/xdg-config" "$CQA_HOME_ROOT/xdg-data" "$CQA_HOME_ROOT/xdg-cache" "$CQA_HOME_ROOT/xdg-state"
run_skill() {
  HOME="$CQA_HOME_ROOT/home" XDG_CONFIG_HOME="$CQA_HOME_ROOT/xdg-config" XDG_DATA_HOME="$CQA_HOME_ROOT/xdg-data" \
    XDG_CACHE_HOME="$CQA_HOME_ROOT/xdg-cache" XDG_STATE_HOME="$CQA_HOME_ROOT/xdg-state" \
    BASH_ENV="$EV/task-7-cqa-env.sh" CODEX_BIN=/opt/homebrew/bin/codex \
    bash "$REPO_ROOT/.agents/skills/codex-qa/scripts/app-server-drive.sh" "$@"
}
printf '\nCOMMAND: scripts/app-server-drive.sh --self-test\n'
run_skill --self-test 2>&1 | tee "$EV/task-7-app-server-self-test.log"
printf '\nCOMMAND: scripts/app-server-drive.sh --plugin --expect sessionStart,userPromptSubmit\n'
run_skill --plugin --expect sessionStart,userPromptSubmit 2>&1 | tee "$EV/task-7-app-server-plugin.log"
printf '\nAPP_SERVER_QA=PASS\n'
