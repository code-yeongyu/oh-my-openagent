#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
PLUGIN_FILE="$REPO_ROOT/dist/index.js"

. "$REPO_ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"
trap - EXIT

DISABLED=0
if [ "${1:-}" = "--disabled" ]; then
  DISABLED=1
elif [ "${1:-}" != "" ]; then
  printf 'ERROR=unknown_arg:%s\n' "$1"
  exit 2
fi

unset XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME OPENCODE_CONFIG_DIR

if ! oqa_require opencode sqlite3 >/dev/null 2>&1; then
  printf 'ERROR=missing_dependency\n'
  exit 1
fi

REALDB="$(oqa_db_path)"
BEFORE_COUNT=0
if [ -n "$REALDB" ] && [ -f "$REALDB" ]; then
  BEFORE_COUNT="$(sqlite3 "$REALDB" 'SELECT count(*) FROM session;' 2>/dev/null || printf '0')"
fi

if ! oqa_mk_isolated_xdg; then
  printf 'ERROR=isolated_xdg_failed\n'
  exit 1
fi

export OPENCODE_CONFIG_DIR="$XDG_CONFIG_HOME/opencode"
mkdir -p "$OPENCODE_CONFIG_DIR/plugins" "$OQA_PROJ"

cat >"$OPENCODE_CONFIG_DIR/opencode.json" <<JSON
{
  "model": "opencode/big-pickle",
  "plugin": ["file:$PLUGIN_FILE"]
}
JSON

cat >"$OPENCODE_CONFIG_DIR/plugins/oh-my-openagent.js" <<JS
export { default } from "file://$PLUGIN_FILE"
JS

PROJECT="$OQA_PROJ"
if [ "$DISABLED" -eq 1 ]; then
  mkdir -p "$PROJECT/.opencode"
  cat >"$PROJECT/.opencode/oh-my-openagent.json" <<'JSON'
{
  "tui": {
    "sidebar": {
      "enabled": false
    }
  }
}
JSON
fi

MIRROR_DIR="$XDG_DATA_HOME/opencode/storage/oh-my-openagent/tui-state"
RUN_OUT="$PROJECT/opencode-run.jsonl"
RUN_ERR="$PROJECT/opencode-run.err"

run_with_timeout() {
  local timeout_s="$1"
  shift
  "$@" >"$RUN_OUT" 2>"$RUN_ERR" &
  local child_pid=$!
  local deadline=$((SECONDS + timeout_s))

  while kill -0 "$child_pid" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      kill "$child_pid" 2>/dev/null || true
      sleep 1
      kill -0 "$child_pid" 2>/dev/null && kill -9 "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null
      return 124
    fi
    sleep 1
  done

  wait "$child_pid"
}

(cd "$PROJECT" && run_with_timeout 60 opencode run --format json "hi")
RUN_RC=$?
FAILED=0

AFTER_COUNT="$BEFORE_COUNT"
if [ -n "$REALDB" ] && [ -f "$REALDB" ]; then
  AFTER_COUNT="$(sqlite3 "$REALDB" 'SELECT count(*) FROM session;' 2>/dev/null || printf '0')"
fi

printf 'MIRROR_DIR=%s\n' "$MIRROR_DIR"
printf 'PROJECT=%s\n' "$PROJECT"
if [ "$AFTER_COUNT" = "$BEFORE_COUNT" ]; then
  printf 'ISO=ISO_OK\n'
else
  printf 'ISO=ISO_LEAK\n'
  FAILED=1
fi

if [ "$RUN_RC" -ne 0 ]; then
  printf 'ERROR=opencode_run_failed:%s\n' "$RUN_RC"
  FAILED=1
fi

MIRROR_COUNT=0
if [ -d "$MIRROR_DIR" ]; then
  MIRROR_COUNT="$(find "$MIRROR_DIR" -type f -name '*.json' | wc -l | tr -d '[:space:]')"
fi
printf 'MIRROR_COUNT=%s\n' "$MIRROR_COUNT"

if [ "$DISABLED" -eq 1 ]; then
  if [ "$MIRROR_COUNT" -ne 0 ]; then
    printf 'ERROR=mirror_written_when_disabled\n'
    FAILED=1
  else
    printf 'MIRROR=MIRROR_DISABLED_OK\n'
  fi
elif [ "$MIRROR_COUNT" -eq 0 ]; then
  printf 'ERROR=mirror_missing_when_enabled\n'
  FAILED=1
else
  printf 'MIRROR=MIRROR_ENABLED_OK\n'
fi

exit "$FAILED"
