#!/usr/bin/env bash
# common.sh - shared helpers for opencode-qa scripts.
#
# Source it from a sibling script:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   . "$SCRIPT_DIR/lib/common.sh"
#
# SAFETY MODEL (read this):
#   - DB-read helpers (oqa_db_path / oqa_db_query) hit the LIVE opencode DB
#     READ-ONLY. That is safe and intended for session investigation.
#   - Anything that SPAWNS opencode (serve / run / tui) must run under an
#     ISOLATED XDG sandbox (oqa_mk_isolated_xdg) so QA never writes junk
#     sessions into the real ~/.local/share/opencode DB.
#   - oqa_cleanup runs on EXIT and tears down servers, tmux sessions, curl
#     watchers, and every temp dir created via the helpers.

# No `set -e`: these scripts deliberately probe failure paths (401, refused).
set -uo pipefail

OQA_TMPDIRS=()
OQA_TMUX_SESSIONS=()
OQA_CURL_PIDS=()
OQA_SERVER_PID=""

oqa_log()  { printf '%s\n' "$*" >&2; }
oqa_pass() { printf 'PASS: %s\n' "$*"; }
oqa_fail() { printf 'FAIL: %s\n' "$*" >&2; return 1; }

# oqa_require <bin>...  -> 0 if all present, else 1 (names the missing ones).
oqa_require() {
  local missing=0 b
  for b in "$@"; do
    if ! command -v "$b" >/dev/null 2>&1; then
      oqa_log "missing dependency: $b"
      missing=1
    fi
  done
  return "$missing"
}

# Absolute path of the active opencode DB (resolves channel / OPENCODE_DB).
oqa_db_path() {
  opencode db path 2>/dev/null | head -1
}

# Escape a value for safe embedding inside a single-quoted SQL literal.
oqa_sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# Run a read-only SQL query against the active DB; emit JSON rows.
# Usage: oqa_db_query "SELECT ... LIMIT 5"
oqa_db_query() {
  opencode db "$1" --format json 2>/dev/null
}

# Preserve HOME-based opencode shims after HOME is sandboxed. Some installed
# opencode wrappers resolve the real binary via "$HOME/.opencode/bin/opencode";
# after oqa_mk_isolated_xdg rewrites HOME, that path must still exist.
oqa_preserve_home_opencode_bin() {
  local real_home="$1" sandbox_home="$2"
  [ -d "$real_home/.opencode/bin" ] || return 0
  mkdir -p "$sandbox_home/.opencode" || return 1
  ln -s "$real_home/.opencode/bin" "$sandbox_home/.opencode/bin" 2>/dev/null || return 1
}

# Create an isolated XDG sandbox so a spawned opencode never touches the real
# DB. Sets globals OQA_XDG_ROOT + OQA_PROJ and exports XDG_*; registers the
# root for cleanup.
#
# IMPORTANT: call this DIRECTLY, never via $(...). Command substitution runs in
# a subshell, which would discard the exports and the cleanup registration.
#   oqa_mk_isolated_xdg            # good
#   root="$OQA_XDG_ROOT"           # read the global afterwards
oqa_mk_isolated_xdg() {
  local root real_home
  root="$(mktemp -d -t oqa-xdg.XXXXXX)" || return 1
  real_home="$HOME"
  OQA_TMPDIRS+=("$root")
  mkdir -p "$root/data" "$root/config" "$root/cache" "$root/state" "$root/home" "$root/proj"
  oqa_preserve_home_opencode_bin "$real_home" "$root/home" || return 1
  export OQA_XDG_ROOT="$root"
  export HOME="$root/home"
  export OPENCODE_TEST_HOME="$root/home"
  export XDG_DATA_HOME="$root/data"
  export XDG_CONFIG_HOME="$root/config"
  export XDG_CACHE_HOME="$root/cache"
  export XDG_STATE_HOME="$root/state"
  export OQA_PROJ="$root/proj"
  # keep the sandbox offline + fast
  export OPENCODE_DISABLE_AUTOUPDATE=1
  export OPENCODE_DISABLE_MODELS_FETCH=1
}

# Print a free TCP port on 127.0.0.1.
oqa_free_port() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
  elif command -v bun >/dev/null 2>&1; then
    bun -e 'const s=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}});console.log(s.port);s.stop()'
  else
    # last resort: a high random port (small race window)
    printf '%s' "$(( (RANDOM % 20000) + 40000 ))"
  fi
}

# Poll an HTTP url until it accepts a connection (any status) or times out.
# Usage: oqa_wait_http <url> [user:pass] [timeout_s]
oqa_wait_http() {
  local url="$1" auth="${2:-}" timeout="${3:-25}" deadline
  deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ -n "$auth" ]; then
      curl -s -o /dev/null -u "$auth" "$url" && return 0
    else
      curl -s -o /dev/null "$url" && return 0
    fi
    sleep 0.2
  done
  return 1
}

# Start an isolated, password-protected headless server.
# Sets globals OQA_SERVER_URL / OQA_SERVER_PASS / OQA_SERVER_PORT / OQA_SERVER_PID.
# Returns 1 if it never becomes ready.
#
# IMPORTANT: call this DIRECTLY, never via $(...). The PID + exports must land
# in the caller's shell so oqa_cleanup can kill the server on exit.
#   oqa_start_server || { oqa_log "no server"; exit 1; }
#   url="$OQA_SERVER_URL"
oqa_start_server() {
  oqa_mk_isolated_xdg || return 1
  local port pass
  port="$(oqa_free_port)"
  pass="oqa-${RANDOM}${RANDOM}"
  OPENCODE_SERVER_PASSWORD="$pass" opencode serve --port "$port" --hostname 127.0.0.1 \
    >"$XDG_STATE_HOME/serve.log" 2>&1 &
  OQA_SERVER_PID=$!
  disown "$OQA_SERVER_PID" 2>/dev/null || true
  export OQA_SERVER_PORT="$port"
  export OQA_SERVER_PASS="$pass"
  export OQA_SERVER_URL="http://127.0.0.1:$port"
  if ! oqa_wait_http "$OQA_SERVER_URL/global/health" "opencode:$pass" 30; then
    oqa_log "server failed to start; log follows:"
    cat "$XDG_STATE_HOME/serve.log" >&2 2>/dev/null || true
    return 1
  fi
}

# Teardown everything the helpers created. Safe to call multiple times.
oqa_cleanup() {
  if [ -n "${OQA_SERVER_PID:-}" ]; then
    kill "$OQA_SERVER_PID" 2>/dev/null || true
    sleep 0.3
    kill -0 "$OQA_SERVER_PID" 2>/dev/null && kill -9 "$OQA_SERVER_PID" 2>/dev/null || true
    OQA_SERVER_PID=""
  fi
  local s p d
  for s in "${OQA_TMUX_SESSIONS[@]:-}"; do
    [ -n "$s" ] && tmux kill-session -t "$s" 2>/dev/null || true
  done
  for p in "${OQA_CURL_PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
    [ -n "$p" ] && sleep 0.1
    [ -n "$p" ] && kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null || true
  done
  for d in "${OQA_TMPDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d" 2>/dev/null || true
  done
  OQA_TMPDIRS=()
  OQA_TMUX_SESSIONS=()
  OQA_CURL_PIDS=()
}
trap oqa_cleanup EXIT

# ---- self-check ------------------------------------------------------------
# Run: bash scripts/lib/common.sh --self-check
oqa__self_check() {
  local fails=0

  if oqa_require opencode sqlite3 curl jq tmux; then
    oqa_pass "dependencies present (opencode sqlite3 curl jq tmux)"
  else
    oqa_log "FAIL: missing dependencies"; fails=$((fails+1))
  fi

  local dbp; dbp="$(oqa_db_path)"
  if [ -n "$dbp" ] && [ -f "$dbp" ]; then
    oqa_pass "oqa_db_path -> $dbp"
  else
    oqa_log "FAIL: oqa_db_path returned '$dbp'"; fails=$((fails+1))
  fi

  local esc; esc="$(oqa_sql_escape "a'b'c")"
  if [ "$esc" = "a''b''c" ]; then
    oqa_pass "oqa_sql_escape quotes single quotes"
  else
    oqa_log "FAIL: oqa_sql_escape -> '$esc'"; fails=$((fails+1))
  fi

  local port; port="$(oqa_free_port)"
  if [ "$port" -gt 0 ] 2>/dev/null; then
    oqa_pass "oqa_free_port -> $port"
  else
    oqa_log "FAIL: oqa_free_port -> '$port'"; fails=$((fails+1))
  fi

  # isolation + trap teardown: an inner shell creates a sandbox (calling the
  # helper DIRECTLY so the cleanup registration survives) and exits; the EXIT
  # trap must remove it. We pass the sandbox path out via a marker file.
  local marker isodir home test_home
  marker="$(mktemp -t oqa-marker.XXXXXX)"
  bash -c '. "'"${BASH_SOURCE[0]}"'"; oqa_mk_isolated_xdg; printf "%s\n%s\n%s\n" "$OQA_XDG_ROOT" "$HOME" "$OPENCODE_TEST_HOME" > "'"$marker"'"'
  isodir="$(sed -n '1p' "$marker" 2>/dev/null)"
  home="$(sed -n '2p' "$marker" 2>/dev/null)"
  test_home="$(sed -n '3p' "$marker" 2>/dev/null)"
  rm -f "$marker"
  if [ -n "$isodir" ] && [ ! -d "$isodir" ]; then
    oqa_pass "isolated XDG sandbox auto-removed on exit ($isodir)"
  else
    oqa_log "FAIL: sandbox not cleaned: '$isodir' (exists=$([ -d "$isodir" ] && echo yes || echo no))"; fails=$((fails+1))
  fi
  if [ -n "$isodir" ] && [ "$home" = "$isodir/home" ] && [ "$test_home" = "$isodir/home" ]; then
    oqa_pass "isolated HOME points inside sandbox"
  else
    oqa_log "FAIL: sandbox HOME not isolated (HOME='$home' OPENCODE_TEST_HOME='$test_home' root='$isodir')"; fails=$((fails+1))
  fi

  local shim_marker shim_result
  shim_marker="$(mktemp -t oqa-shim.XXXXXX)"
  bash -c '
    set -u
    . "'"${BASH_SOURCE[0]}"'"
    fake_home="$(mktemp -d -t oqa-fake-home.XXXXXX)"
    mkdir -p "$fake_home/.local/bin" "$fake_home/.opencode/bin"
    printf "%s\n" "#!/usr/bin/env bash" "exec \"\$HOME/.opencode/bin/opencode\" \"\$@\"" > "$fake_home/.local/bin/opencode"
    printf "%s\n" "#!/usr/bin/env bash" "exec \"\$HOME/.opencode/bin/opencode-real\" \"\$@\"" > "$fake_home/.opencode/bin/opencode"
    printf "%s\n" "#!/usr/bin/env bash" "printf fake-opencode-ok" > "$fake_home/.opencode/bin/opencode-real"
    chmod +x "$fake_home/.local/bin/opencode" "$fake_home/.opencode/bin/opencode" "$fake_home/.opencode/bin/opencode-real"
    HOME="$fake_home"
    PATH="$fake_home/.local/bin:$PATH"
    oqa_mk_isolated_xdg
    opencode > "'"$shim_marker"'"
    oqa_cleanup
    rm -rf "$fake_home"
  '
  shim_result="$(cat "$shim_marker" 2>/dev/null)"
  rm -f "$shim_marker"
  if [ "$shim_result" = "fake-opencode-ok" ]; then
    oqa_pass "isolated HOME preserves HOME-based opencode shim"
  else
    oqa_log "FAIL: HOME-based opencode shim returned '$shim_result'"; fails=$((fails+1))
  fi

  if [ "$fails" -eq 0 ]; then
    oqa_pass "common.sh self-check"
    return 0
  fi
  oqa_log "common.sh self-check had $fails failure(s)"
  return 1
}

if [ "${1:-}" = "--self-check" ]; then
  oqa__self_check
  exit $?
fi
