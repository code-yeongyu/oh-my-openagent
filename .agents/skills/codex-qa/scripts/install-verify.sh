#!/usr/bin/env bash
# install-verify.sh - install THIS repo's local omo build into an ISOLATED
# CODEX_HOME and prove it landed correctly while the real ~/.codex is untouched.
#
# Asserts: plugin cache dir exists, config.toml enables omo@sisyphuslabs, the
# component bins + agent TOMLs linked inside the sandbox, and the real
# ~/.codex/config.toml shasum is unchanged.
#
#   --self-test   run the full isolated install + assertions (default)
#   --keep        keep the isolated home and print its path for inspection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

cqa_install_verify() {
  cqa_require codex node || return 1
  cqa_guard_real_home
  cqa_mk_isolated_home
  cqa_log "installing local omo into $CODEX_HOME ..."
  if ! cqa_install_local_omo; then
    cqa_log "install failed; tail:"; tail -25 "$CQA_HOME_ROOT/install.log" >&2 2>/dev/null
    return 1
  fi
  local fails=0
  if ls "$CODEX_HOME"/plugins/cache/sisyphuslabs/omo/*/ >/dev/null 2>&1; then
    cqa_pass "plugin cache present ($(ls "$CODEX_HOME"/plugins/cache/sisyphuslabs/omo/ | head -1))"
  else cqa_log "FAIL: plugin cache missing"; fails=$((fails+1)); fi

  if grep -q '\[plugins."omo@sisyphuslabs"\]' "$CODEX_HOME/config.toml" 2>/dev/null \
     && grep -A2 '\[plugins."omo@sisyphuslabs"\]' "$CODEX_HOME/config.toml" | grep -q 'enabled = true'; then
    cqa_pass "config.toml enables omo@sisyphuslabs"
  else cqa_log "FAIL: omo not enabled in isolated config.toml"; fails=$((fails+1)); fi

  if ls "$CODEX_HOME"/bin/omo-* >/dev/null 2>&1; then
    cqa_pass "component bins linked in sandbox ($(ls "$CODEX_HOME"/bin/omo-* | wc -l | tr -d ' ') bins)"
  else cqa_log "FAIL: no component bins under $CODEX_HOME/bin"; fails=$((fails+1)); fi

  if [ -d "$CODEX_HOME/agents" ] && ls "$CODEX_HOME"/agents/*.toml >/dev/null 2>&1; then
    cqa_pass "agent TOMLs linked in sandbox"
  else cqa_log "FAIL: no agent TOMLs under $CODEX_HOME/agents"; fails=$((fails+1)); fi

  cqa_assert_real_home_unchanged || fails=$((fails+1))

  [ "$KEEP" = "1" ] && cqa_log "kept isolated home: $CODEX_HOME"
  if [ "$fails" -eq 0 ]; then cqa_pass "install-verify"; return 0; fi
  cqa_log "install-verify had $fails failure(s)"; return 1
}

KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test) shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) cqa_log "unknown option: $1"; shift ;;
  esac
done
[ "$KEEP" = "1" ] && trap - EXIT
cqa_install_verify
exit $?
