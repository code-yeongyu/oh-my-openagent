#!/usr/bin/env bash
# app-server-drive.sh - FIRST-PARTY codex QA: drive a real `codex app-server`
# turn against an ISOLATED CODEX_HOME + a LOCAL mock model, and read the
# structured notification stream. This is how you prove the omo plugin behaves
# in a live Codex session without scripting the TUI and without a real API call.
#
# Modes:
#   --self-test   Bare isolated home (no plugin). Proves the driver works: a
#                 turn runs and the assistant message comes back from the mock.
#                 Fast; no install.
#   --plugin      Install THIS repo's local omo build into the isolated home,
#                 then drive a turn and PROVE the plugin hooks fire by asserting
#                 hook/completed notifications for the expected events.
#                 Heavier (runs install-local).
#
# Options (any mode):
#   --prompt <text>    user message (default: "say hello"; --plugin defaults to
#                      "ulw: say hello" so the ultrawork userPromptSubmit hook fires)
#   --expect <ev,...>  hook eventNames that MUST complete (default in --plugin:
#                      "sessionStart,userPromptSubmit")
#   --keep             do not delete the isolated home (for inspection)
#
# The captured JSON summary IS the evidence; redirect it into .omo/evidence/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

cqa_drive() {
  local plugin="$1" prompt="$2" expect="$3"
  cqa_require codex node jq || return 1
  cqa_guard_real_home
  cqa_mk_isolated_home
  if [ "$plugin" = "1" ]; then
    cqa_log "installing local omo build into $CODEX_HOME (this builds the plugin)..."
    if ! cqa_install_local_omo; then
      cqa_log "install failed; tail:"; tail -20 "$CQA_HOME_ROOT/install.log" >&2 2>/dev/null
      return 1
    fi
    grep -q 'omo@sisyphuslabs' "$CODEX_HOME/config.toml" || { cqa_fail "omo not enabled in isolated config.toml"; return 1; }
  fi
  cqa_start_mock || return 1
  local out
  out="$(EXPECT_HOOK="$expect" PROMPT="$prompt" DEADLINE_MS="${DEADLINE_MS:-90000}" \
    node "$SCRIPT_DIR/lib/app-server-client.mjs")"
  local rc=$?
  printf '%s\n' "$out"
  cqa_assert_real_home_unchanged || rc=1
  if [ "$rc" -eq 0 ]; then
    cqa_pass "app-server turn completed; assistant text: $(printf '%s' "$out" | jq -r '.assistantText')"
    [ -n "$expect" ] && cqa_pass "hooks fired: $(printf '%s' "$out" | jq -r '[.hooks[]|select(.method=="hook/completed")|.eventName]|unique|join(", ")')"
  else
    cqa_log "missing hooks: $(printf '%s' "$out" | jq -rc '.missingHooks? // []')"
  fi
  return "$rc"
}

MODE="--self-test"; PROMPT=""; EXPECT=""; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test|--plugin) MODE="$1"; shift ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --expect) EXPECT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) cqa_log "unknown option: $1"; shift ;;
  esac
done

if [ "$KEEP" = "1" ]; then trap - EXIT; fi

if [ "$MODE" = "--plugin" ]; then
  cqa_drive 1 "${PROMPT:-ulw: say hello}" "${EXPECT:-sessionStart,userPromptSubmit}"
else
  cqa_drive 0 "${PROMPT:-say hello}" "$EXPECT"
fi
exit $?
