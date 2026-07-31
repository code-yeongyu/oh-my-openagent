#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/.omo/evidence/20260721-defaults-oracle-gpt56-opus48"
QA_SKILL_DIR="$REPO_ROOT/.agents/skills/opencode-qa"
HOST_DB="$(opencode db path)"
HOST_SESSIONS_BEFORE="$(sqlite3 "$HOST_DB" 'SELECT count(*) FROM session;')"

source "$REPO_ROOT/script/agent/qa-sandbox.sh" >/dev/null
export HOME="$OMO_QA_ROOT/home"
export OMO_DISABLE_POSTHOG=1
mkdir -p "$HOME" "$XDG_CONFIG_HOME/opencode" "$OMO_QA_ROOT/project"

cleanup() {
  rm -rf "$OMO_QA_ROOT"
  if [ ! -e "$OMO_QA_ROOT" ]; then
    printf 'sandbox_removed=true\n' >> "$EVIDENCE_DIR/isolation-and-cleanup.txt"
  fi
}
trap cleanup EXIT

cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<EOF
{
  "plugin": ["file://$REPO_ROOT/dist/index.js"]
}
EOF

cd "$OMO_QA_ROOT/project"
opencode --version > "$EVIDENCE_DIR/opencode-version.txt"
opencode debug agent oracle \
  | jq '{name, mode, model, variant, temperature}' \
  | tee "$EVIDENCE_DIR/oracle-agent.json"

jq -e '
  .name == "oracle" and
  .mode == "subagent" and
  .model.providerID == "openai" and
  .model.modelID == "gpt-5.6-sol" and
  .variant == "xhigh" and
  .temperature == 0.1
' "$EVIDENCE_DIR/oracle-agent.json" >/dev/null

SANDBOX_DB="$(opencode db path)"
SANDBOX_SESSIONS="$(sqlite3 "$SANDBOX_DB" 'SELECT count(*) FROM session;')"
bash "$QA_SKILL_DIR/scripts/tui-smoke.sh" --self-test > "$EVIDENCE_DIR/tui-smoke.txt" 2>&1
HOST_SESSIONS_AFTER="$(sqlite3 "$HOST_DB" 'SELECT count(*) FROM session;')"

if [ "$HOST_SESSIONS_BEFORE" != "$HOST_SESSIONS_AFTER" ]; then
  printf 'host OpenCode session count changed: %s -> %s\n' "$HOST_SESSIONS_BEFORE" "$HOST_SESSIONS_AFTER" >&2
  exit 1
fi

cat > "$EVIDENCE_DIR/isolation-and-cleanup.txt" <<EOF
host_database=host-opencode-db
host_session_count_before=$HOST_SESSIONS_BEFORE
sandbox_database=isolated-opencode-db
sandbox_session_count_after_registry_probe=$SANDBOX_SESSIONS
host_session_count_after=$HOST_SESSIONS_AFTER
host_session_count_unchanged=true
sandbox_uses_dist_plugin=true
EOF

printf 'PASS: isolated real OpenCode loaded dist/index.js and resolved Oracle to openai/gpt-5.6-sol xhigh.\n'
