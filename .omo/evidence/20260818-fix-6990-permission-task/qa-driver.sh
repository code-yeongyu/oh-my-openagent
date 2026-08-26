#!/usr/bin/env bash
# QA driver for issue #6990 (permission.task user override).
#
# WHAT IS TESTED: real `opencode serve` (v1.18.18) loading THIS worktree's
# built plugin dist (file:// dist/index.js), with a user-layer omo.jsonc
# `[opencode]` harness block that sets agents.<main-agent>.permission.task
# = "ask" for sisyphus/atlas/hephaestus/prometheus. Asserts the served
# agents' effective task action is "ask" (user config wins over the
# plugin-injected "allow" default). Negative control: identical boot WITHOUT
# user task config -> effective task action "allow" (default preserved).
#
# A fake OpenAI provider (baseURL 127.0.0.1, never called; agent registration
# only needs model metadata) lets atlas register, which otherwise requires a
# resolvable model.
#
# ISOLATION: oqa_mk_isolated_xdg redirects HOME + XDG_* to throwaway dirs;
# the real opencode.db session count is compared before/after as proof.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.agents/skills/opencode-qa/scripts" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
DIST_ENTRY="file://$REPO_ROOT/dist/index.js"

. "$SCRIPT_DIR/lib/common.sh"
trap oqa_cleanup EXIT

oqa_require opencode curl jq sqlite3 || exit 1

REAL_DB="$HOME/.local/share/opencode/opencode.db"
real_db_count() { sqlite3 "file:$REAL_DB?mode=ro" "SELECT count(*) FROM session" 2>/dev/null || echo "nodb"; }
BEFORE="$(real_db_count)"

FAILS=0
assert_task() { # <agent> <got> <want>
  if [ "$2" = "$3" ]; then oqa_pass "$1 effective task action=$2"; else oqa_fail "$1 effective task action=$2 (want $3)"; FAILS=$((FAILS+1)); fi
}

run_scenario() { # <label> <with-user-config: yes|no>
  local label="$1" with_cfg="$2"
  oqa_mk_isolated_xdg || { oqa_log "sandbox setup failed"; exit 1; }
  mkdir -p "$XDG_CONFIG_HOME/opencode"
  cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<JSONC
{
  "plugin": ["$DIST_ENTRY"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:9/v1",
        "timeout": 30000
      },
      "models": {
        "gpt-fake": {
          "tool_call": true,
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  }
}
JSONC
  if [ "$with_cfg" = "yes" ]; then
    mkdir -p "$HOME/.omo"
    cat > "$HOME/.omo/omo.jsonc" <<'EOF'
{
  "[opencode]": {
    "agents": {
      "sisyphus":   { "permission": { "task": "ask" } },
      "atlas":      { "permission": { "task": "ask" } },
      "hephaestus": { "permission": { "task": "ask" } },
      "prometheus": { "permission": { "task": "ask" } }
    }
  }
}
EOF
  fi
  cd "$OQA_PROJ" || exit 1

  local port pass
  port="$(oqa_free_port)"
  pass="oqa-${RANDOM}${RANDOM}"
  OPENCODE_SERVER_PASSWORD="$pass" opencode serve --port "$port" --hostname 127.0.0.1 \
    > "$XDG_STATE_HOME/serve-$label.log" 2>&1 &
  OQA_SERVER_PID=$!
  disown "$OQA_SERVER_PID" 2>/dev/null || true
  local url="http://127.0.0.1:$port"
  if ! oqa_wait_http "$url/global/health" "opencode:$pass" 60; then
    oqa_log "[$label] server failed to start; log follows:"
    cat "$XDG_STATE_HOME/serve-$label.log"
    exit 1
  fi

  curl -s -u "opencode:$pass" "$url/agent" > "$XDG_STATE_HOME/agent-$label.json"
  echo "[$label] served main-agent effective task permissions:"
  for agent in sisyphus atlas hephaestus prometheus; do
    local got want
    got="$(jq -r --arg a "$agent" \
      'first(.[] | select(.name|ascii_downcase|startswith($a)) |
        (.permission // []) | map(select(.permission == "task" and .pattern == "*") | .action) | last // "<unset>")' \
      "$XDG_STATE_HOME/agent-$label.json")"
    if [ "$with_cfg" = "yes" ]; then want="ask"; else want="allow"; fi
    assert_task "$agent" "${got:-<missing-agent>}" "$want"
  done
  echo "[$label] all served agent names: $(jq -r '[.[].name] | join(", ")' "$XDG_STATE_HOME/agent-$label.json")"
  echo "[$label] raw task entries per main agent (dedup):"
  for agent in sisyphus atlas hephaestus prometheus; do
    jq -r --arg a "$agent" \
      'first(.[] | select(.name|ascii_downcase|startswith($a)) |
        (.permission // []) | map(select(.permission == "task") | "\(.pattern)=\(.action)") | join(" ")) // "no-agent"' \
      "$XDG_STATE_HOME/agent-$label.json" | sed "s/^/[$label] $agent: /"
  done

  kill "$OQA_SERVER_PID" 2>/dev/null || true
  OQA_SERVER_PID=""
}

run_scenario user-config yes
run_scenario default no

AFTER="$(real_db_count)"
if [ "$BEFORE" = "$AFTER" ]; then
  oqa_pass "isolation: real opencode.db session count unchanged ($BEFORE -> $AFTER)"
else
  oqa_fail "isolation: real opencode.db session count changed ($BEFORE -> $AFTER)"
  FAILS=$((FAILS+1))
fi

if [ "$FAILS" -eq 0 ]; then oqa_log "ALL QA CHECKS PASSED"; else oqa_log "$FAILS QA CHECK(S) FAILED"; exit 1; fi
