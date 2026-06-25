#!/usr/bin/env bash
# hook-unit-probe.sh - deterministic, binary-free proof that a single omo
# component's hook logic fires. Pipes a synthetic Codex hook event (the exact
# stdin shape Codex sends) into the component's cached dist/cli.js and asserts
# its stdout - no codex process, no model, no network. Fast and exact.
#
# Use this to pin a specific component's behavior; use app-server-drive.sh
# --plugin to prove the app-server actually WIRES that hook in a live turn.
#
#   --self-test                 install local omo (if needed), then assert the
#                               ultrawork component injects <ultrawork-mode> on
#                               an "ulw" UserPromptSubmit. (default)
#   --component <name> --event <kebab-event> [--prompt <text>]
#                               run an arbitrary component/event by hand against
#                               an already-installed isolated CODEX_HOME ($CODEX_HOME).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

cqa_plugin_root() {
  ls -d "$CODEX_HOME"/plugins/cache/sisyphuslabs/omo/*/ 2>/dev/null | head -1
}

cqa_run_component() {
  local comp="$1" event="$2" prompt="$3" root cli
  root="$(cqa_plugin_root)"; [ -n "$root" ] || { cqa_fail "no installed omo under $CODEX_HOME"; return 1; }
  cli="$root/components/$comp/dist/cli.js"
  [ -f "$cli" ] || { cqa_fail "component cli missing: $cli"; return 1; }
  local payload
  payload="$(jq -nc --arg p "$prompt" --arg cwd "${QA_CWD:-$PWD}" \
    '{hook_event_name:"UserPromptSubmit",prompt:$p,cwd:$cwd,session_id:"cqa-unit",model:"mock-model"}')"
  printf '%s' "$payload" | PLUGIN_ROOT="$root" PLUGIN_DATA="$CODEX_HOME/plugins/data/omo-$comp" node "$cli" hook "$event"
}

cqa_self_test() {
  cqa_require codex node jq || return 1
  cqa_guard_real_home
  cqa_mk_isolated_home
  cqa_log "installing local omo into $CODEX_HOME ..."
  cqa_install_local_omo || { tail -20 "$CQA_HOME_ROOT/install.log" >&2; return 1; }
  local out
  out="$(cqa_run_component ultrawork user-prompt-submit "ulw: do the thing")"
  cqa_assert_real_home_unchanged || return 1
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | test("ultrawork-mode")' >/dev/null 2>&1; then
    cqa_pass "ultrawork UserPromptSubmit injected <ultrawork-mode> on an ulw prompt"
    return 0
  fi
  cqa_log "FAIL: ultrawork did not inject ultrawork-mode; got: $out"; return 1
}

MODE="self"; COMP=""; EVENT=""; PROMPT="ulw: do the thing"
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test) MODE="self"; shift ;;
    --component) MODE="manual"; COMP="$2"; shift 2 ;;
    --event) EVENT="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) cqa_log "unknown option: $1"; shift ;;
  esac
done

if [ "$MODE" = "manual" ]; then
  [ -n "$COMP" ] && [ -n "$EVENT" ] || { cqa_log "manual mode needs --component and --event"; exit 2; }
  cqa_run_component "$COMP" "$EVENT" "$PROMPT"
  exit $?
fi
cqa_self_test
exit $?
