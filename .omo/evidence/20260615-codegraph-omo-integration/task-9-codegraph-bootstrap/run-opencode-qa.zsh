#!/bin/zsh
set -u

SCENARIO="${1:-normal}"
REPO="/Users/yeongyu/local-workspaces/omo-wt/codegraph-omo-integration"
EVIDENCE_DIR="$REPO/.omo/evidence/20260615-codegraph-omo-integration/task-9-codegraph-bootstrap"
OUT="$EVIDENCE_DIR/opencode-${SCENARIO}.txt"

mkdir -p "$EVIDENCE_DIR"
exec > >(tee "$OUT") 2>&1

echo "QA_SCENARIO=$SCENARIO"
echo "QA_STARTED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "REPO=$REPO"
echo "OPENCODE_VERSION=$(opencode --version 2>/dev/null || true)"

REAL_HOME="$HOME"
REAL_DB="$REAL_HOME/.local/share/opencode/opencode.db"
REAL_BEFORE="$(sqlite3 "$REAL_DB" 'select count(*) from session' 2>/dev/null || echo 0)"

QA_ROOT="$(mktemp -d)"
export HOME="$QA_ROOT/home"
export TMPDIR="$QA_ROOT/tmp"
export XDG_DATA_HOME="$QA_ROOT/xdg-data"
export XDG_CONFIG_HOME="$QA_ROOT/xdg-config"
export XDG_STATE_HOME="$QA_ROOT/xdg-state"
export XDG_CACHE_HOME="$QA_ROOT/xdg-cache"
mkdir -p "$HOME" "$TMPDIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME/opencode" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

printf '{"plugin":["%s/dist/index.js"]}\n' "$REPO" > "$XDG_CONFIG_HOME/opencode/opencode.jsonc"

PROJECT="$QA_ROOT/project"
mkdir -p "$PROJECT"
cd "$PROJECT" || exit 1
git init -q

if [[ "$SCENARIO" == "missing-bin" ]]; then
  export OMO_CODEGRAPH_BIN="/nonexistent"
fi
export OMO_LOG="debug"

echo "QA_ROOT=$QA_ROOT"
echo "PROJECT=$PROJECT"
echo "XDG_DATA_HOME=$XDG_DATA_HOME"
echo "XDG_CONFIG_HOME=$XDG_CONFIG_HOME"
echo "TMPDIR=$TMPDIR"
echo "REAL_BEFORE=$REAL_BEFORE"
echo "CONFIG=$(cat "$XDG_CONFIG_HOME/opencode/opencode.jsonc")"

opencode run --format json --model openai/gpt-5.4 "Reply exactly OK." &
RUN_PID="$!"
RUN_STATUS=124
for _ in {1..120}; do
  if ! kill -0 "$RUN_PID" 2>/dev/null; then
    wait "$RUN_PID"
    RUN_STATUS="$?"
    break
  fi
  sleep 1
done
if kill -0 "$RUN_PID" 2>/dev/null; then
  echo "RUN_TIMEOUT=1"
  kill "$RUN_PID" 2>/dev/null || true
  wait "$RUN_PID" 2>/dev/null || true
fi

LOG_FILE="$TMPDIR/oh-my-opencode.log"
for _ in {1..30}; do
  if [[ -f "$LOG_FILE" ]] && grep -q 'codegraph-bootstrap' "$LOG_FILE"; then
    break
  fi
  sleep 1
done

ISO_DB="$XDG_DATA_HOME/opencode/opencode.db"
ISO_SESSIONS="$(sqlite3 "$ISO_DB" 'select count(*) from session' 2>/dev/null || echo 0)"
REAL_AFTER="$(sqlite3 "$REAL_DB" 'select count(*) from session' 2>/dev/null || echo 0)"

echo "RUN_STATUS=$RUN_STATUS"
echo "ISO_DB=$ISO_DB"
echo "ISO_SESSIONS=$ISO_SESSIONS"
echo "REAL_AFTER=$REAL_AFTER"
if [[ "$REAL_AFTER" == "$REAL_BEFORE" ]]; then
  echo "REAL_DB_UNCHANGED=1"
else
  echo "REAL_DB_UNCHANGED=0"
fi
if [[ -L "$PROJECT/.codegraph" ]]; then
  echo "CODEGRAPH_LINK=$(readlink "$PROJECT/.codegraph")"
elif [[ -d "$PROJECT/.codegraph" ]]; then
  echo "CODEGRAPH_DIR=in-project"
else
  echo "CODEGRAPH_DIR=absent"
fi
if [[ -f "$PROJECT/.git/info/exclude" ]]; then
  echo "GIT_EXCLUDE_CODEGRAPH=$(grep -c '^.codegraph$' "$PROJECT/.git/info/exclude" || true)"
fi
if [[ -f "$LOG_FILE" ]]; then
  echo "LOG_FILE=$LOG_FILE"
  grep 'codegraph-bootstrap' "$LOG_FILE" || true
else
  echo "LOG_FILE_MISSING=$LOG_FILE"
fi

rm -rf "$QA_ROOT"
if [[ -e "$QA_ROOT" ]]; then
  echo "CLEANUP_QA_ROOT_REMOVED=0"
else
  echo "CLEANUP_QA_ROOT_REMOVED=1"
fi
echo "QA_DONE=$SCENARIO"
echo "QA_FINISHED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
exit "$RUN_STATUS"
