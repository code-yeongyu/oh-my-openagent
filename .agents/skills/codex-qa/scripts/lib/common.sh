#!/usr/bin/env bash
# common.sh - shared helpers for codex-qa scripts.
#
# Source it from a sibling script:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   . "$SCRIPT_DIR/lib/common.sh"
#
# SAFETY MODEL (read this):
#   - We QA ONLY our plugin, never the user's real codex. Everything that
#     spawns codex runs against an ISOLATED CODEX_HOME (cqa_mk_isolated_home)
#     plus a LOCAL mock model provider (cqa_start_mock) - so there is no real
#     API call and the real ~/.codex is never read or written.
#   - cqa_guard_real_home snapshots the real ~/.codex/config.toml up front;
#     cqa_assert_real_home_unchanged proves QA never touched it.
#   - cqa_cleanup runs on EXIT and tears down the app-server, mock model, tmux
#     sessions, and every temp dir the helpers created.
#
# The interactive shell may wrap `codex` in a function that injects
# `--profile`; bash scripts do not see that function, so `codex` here is the
# real binary on PATH. We still resolve it explicitly via cqa_codex_bin.

set -uo pipefail

CQA_TMPDIRS=()
CQA_PIDS=()
CQA_TMUX_SESSIONS=()
CQA_REAL_HOME_SUM=""

cqa_log()  { printf '%s\n' "$*" >&2; }
cqa_pass() { printf 'PASS: %s\n' "$*"; }
cqa_fail() { printf 'FAIL: %s\n' "$*" >&2; return 1; }

# cqa_require <bin>...  -> 0 if all present, else 1 (names the missing ones).
cqa_require() {
  local missing=0 b
  for b in "$@"; do
    command -v "$b" >/dev/null 2>&1 || { cqa_log "missing dependency: $b"; missing=1; }
  done
  return "$missing"
}

# Absolute path of the REAL codex binary (bypasses any interactive shell
# function/alias). Override with CODEX_BIN.
cqa_codex_bin() {
  if [ -n "${CODEX_BIN:-}" ]; then printf '%s' "$CODEX_BIN"; return 0; fi
  command -v codex 2>/dev/null
}

cqa_real_codex_home() { printf '%s' "${HOME}/.codex"; }

# Snapshot the real ~/.codex/config.toml so we can prove QA never touched it.
cqa_guard_real_home() {
  local cfg; cfg="$(cqa_real_codex_home)/config.toml"
  if [ -f "$cfg" ]; then
    CQA_REAL_HOME_SUM="$(shasum "$cfg" 2>/dev/null | awk '{print $1}')"
  else
    CQA_REAL_HOME_SUM="ABSENT"
  fi
}

cqa_assert_real_home_unchanged() {
  local cfg now; cfg="$(cqa_real_codex_home)/config.toml"
  if [ -f "$cfg" ]; then now="$(shasum "$cfg" 2>/dev/null | awk '{print $1}')"; else now="ABSENT"; fi
  if [ "$now" = "$CQA_REAL_HOME_SUM" ]; then
    cqa_pass "real ~/.codex/config.toml unchanged ($now)"
    return 0
  fi
  cqa_fail "real ~/.codex/config.toml CHANGED ($CQA_REAL_HOME_SUM -> $now)"
}

# Create an isolated CODEX_HOME and project dir, export the env that keeps the
# run hermetic, and register the temp root for cleanup. Sets globals
# CQA_HOME_ROOT / CODEX_HOME / OMO_CODEX_PROJECT / QA_CWD.
#
# IMPORTANT: call this DIRECTLY, never via $(...). A subshell would discard the
# exports and the cleanup registration.
cqa_mk_isolated_home() {
  local root; root="$(mktemp -d -t cqa-home.XXXXXX)" || return 1
  CQA_TMPDIRS+=("$root")
  # CODEX_HOME must EXIST before codex launches, or codex hard-errors.
  mkdir -p "$root/codex" "$root/proj"
  export CQA_HOME_ROOT="$root"
  export CODEX_HOME="$root/codex"
  export OMO_CODEX_PROJECT="$root/proj"
  export QA_CWD="$root/proj"
  # never leak install bins or telemetry out of the sandbox
  export CODEX_LOCAL_BIN_DIR="$root/codex/bin"
  export OMO_DISABLE_POSTHOG=1
  export OMO_CODEX_DISABLE_POSTHOG=1
}

# Start the local mock model server. Sets CQA_MOCK_PID + exports MOCK_PORT.
# Call DIRECTLY (not via $(...)) so the PID + export land in the caller.
cqa_start_mock() {
  local lib_dir log; lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  log="$(mktemp -t cqa-mock.XXXXXX)"; CQA_TMPDIRS+=("$log")
  node "$lib_dir/mock-model.mjs" >"$log" 2>&1 &
  CQA_MOCK_PID=$!; CQA_PIDS+=("$CQA_MOCK_PID")
  local i port=""
  for i in $(seq 1 100); do
    port="$(awk '/MOCK_LISTENING/{print $2; exit}' "$log" 2>/dev/null)"
    [ -n "$port" ] && break
    kill -0 "$CQA_MOCK_PID" 2>/dev/null || { cqa_log "mock model died:"; cat "$log" >&2; return 1; }
    sleep 0.1
  done
  [ -n "$port" ] || { cqa_log "mock model never reported a port"; return 1; }
  export MOCK_PORT="$port"
}

# Install THIS repo's local omo build into the isolated CODEX_HOME. Requires
# cqa_mk_isolated_home first. REPO_ROOT defaults to the repo containing this skill.
cqa_install_local_omo() {
  local repo="${REPO_ROOT:-}"
  if [ -z "$repo" ]; then
    repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
  fi
  local installer="$repo/packages/omo-codex/scripts/install-local.mjs"
  [ -f "$installer" ] || { cqa_fail "installer not found: $installer"; return 1; }
  node "$installer" install >"$CQA_HOME_ROOT/install.log" 2>&1
}

# Teardown everything the helpers created. Safe to call multiple times.
cqa_cleanup() {
  local p s d
  for p in "${CQA_PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
  done
  for s in "${CQA_TMUX_SESSIONS[@]:-}"; do
    [ -n "$s" ] && tmux kill-session -t "$s" 2>/dev/null || true
  done
  for d in "${CQA_TMPDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d" 2>/dev/null || true
  done
  CQA_TMPDIRS=(); CQA_PIDS=(); CQA_TMUX_SESSIONS=()
}
trap cqa_cleanup EXIT

# ---- self-check ------------------------------------------------------------
# Run: bash scripts/lib/common.sh --self-check
cqa__self_check() {
  local fails=0
  if cqa_require codex node jq tmux; then cqa_pass "dependencies present (codex node jq tmux)"
  else cqa_log "FAIL: missing dependencies"; fails=$((fails+1)); fi

  local bin; bin="$(cqa_codex_bin)"
  if [ -n "$bin" ]; then cqa_pass "codex binary -> $bin"
  else cqa_log "FAIL: codex binary not found"; fails=$((fails+1)); fi

  cqa_guard_real_home

  # isolation + trap teardown: an inner shell creates a sandbox (DIRECTLY) and
  # exits; the EXIT trap must remove it. Pass the path out via a marker file.
  local marker root home
  marker="$(mktemp -t cqa-marker.XXXXXX)"
  bash -c '. "'"${BASH_SOURCE[0]}"'"; cqa_mk_isolated_home; printf "%s\n%s\n" "$CQA_HOME_ROOT" "$CODEX_HOME" > "'"$marker"'"'
  root="$(sed -n '1p' "$marker" 2>/dev/null)"; home="$(sed -n '2p' "$marker" 2>/dev/null)"
  rm -f "$marker"
  if [ -n "$root" ] && [ ! -d "$root" ]; then cqa_pass "isolated CODEX_HOME auto-removed on exit ($root)"
  else cqa_log "FAIL: sandbox not cleaned: '$root'"; fails=$((fails+1)); fi
  if [ -n "$home" ] && [ "$home" = "$root/codex" ]; then cqa_pass "CODEX_HOME points inside sandbox, not ~/.codex"
  else cqa_log "FAIL: CODEX_HOME not isolated ('$home')"; fails=$((fails+1)); fi

  # mock model: start it, confirm it serves the Responses SSE, then cleanup.
  cqa_mk_isolated_home
  if cqa_start_mock; then
    if curl -s -X POST "http://127.0.0.1:$MOCK_PORT/v1/responses" -d '{}' 2>/dev/null | grep -q 'response.completed'; then
      cqa_pass "mock model serves Responses SSE on :$MOCK_PORT"
    else cqa_log "FAIL: mock model did not return response.completed"; fails=$((fails+1)); fi
  else cqa_log "FAIL: mock model did not start"; fails=$((fails+1)); fi

  cqa_assert_real_home_unchanged || fails=$((fails+1))

  if [ "$fails" -eq 0 ]; then cqa_pass "common.sh self-check"; return 0; fi
  cqa_log "common.sh self-check had $fails failure(s)"; return 1
}

if [ "${1:-}" = "--self-check" ]; then
  cqa__self_check
  exit $?
fi
