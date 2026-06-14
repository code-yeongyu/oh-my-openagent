#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
QA_SCRIPT_DIR="$REPO_ROOT/.agents/skills/opencode-qa/scripts"
. "$QA_SCRIPT_DIR/lib/common.sh"

FAKE_SERVER_PID=""
FAKE_SERVER_PORT=""
FAKE_LLM_LOG="$SCRIPT_DIR/fake-llm-team-create.log"
RUN_JSONL="$SCRIPT_DIR/opencode-run-team-create.jsonl"
ASSERTIONS="$SCRIPT_DIR/team-create-assertions.txt"

tc_log() { printf '%s\n' "$*" >&2; }
tc_pass() { printf 'PASS: %s\n' "$*" | tee -a "$ASSERTIONS"; }
tc_fail() { printf 'FAIL: %s\n' "$*" | tee -a "$ASSERTIONS" >&2; return 1; }

tc_cleanup() {
  if [ -n "${FAKE_SERVER_PID:-}" ]; then
    kill "$FAKE_SERVER_PID" 2>/dev/null || true
    sleep 0.3
    kill -0 "$FAKE_SERVER_PID" 2>/dev/null && kill -9 "$FAKE_SERVER_PID" 2>/dev/null || true
    FAKE_SERVER_PID=""
  fi
}
trap 'tc_cleanup; oqa_cleanup' EXIT

tc_start_fake_llm() {
  local port_file
  port_file="$(mktemp -t team-create-fake-llm.XXXXXX)" || return 1
  OQA_TMPDIRS+=("$port_file" "$port_file.stdout")
  FAKE_LLM_LOG="$FAKE_LLM_LOG" FAKE_OPENAI_PORT=0 bun run --bun "$SCRIPT_DIR/fake-openai-team-create-server.mjs" >"$port_file.stdout" 2>&1 &
  FAKE_SERVER_PID=$!
  disown "$FAKE_SERVER_PID" 2>/dev/null || true

  local deadline
  deadline=$(( $(date +%s) + 10 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if grep -q "^fake-openai listening on " "$port_file.stdout" 2>/dev/null; then
      FAKE_SERVER_PORT="$(grep "^fake-openai listening on " "$port_file.stdout" | head -1 | awk '{print $NF}')"
      break
    fi
    if ! kill -0 "$FAKE_SERVER_PID" 2>/dev/null; then
      tc_log "fake-openai server died"
      cat "$port_file.stdout" >&2 2>/dev/null || true
      return 1
    fi
    sleep 0.2
  done

  if [ -z "$FAKE_SERVER_PORT" ]; then
    tc_log "fake-openai server did not report port"
    cat "$port_file.stdout" >&2 2>/dev/null || true
    return 1
  fi
  if ! curl -sf "http://127.0.0.1:${FAKE_SERVER_PORT}/health" >/dev/null 2>&1; then
    tc_log "fake-openai health failed"
    return 1
  fi
}

tc_write_configs() {
  local cfg_dir="$1"
  mkdir -p "$cfg_dir/opencode" "$OQA_PROJ/.opencode"
  cat >"$cfg_dir/opencode/oh-my-openagent.json" <<JSON
{
  "team_mode": { "enabled": true },
  "agents": {
    "sisyphus-junior": { "model": "openai/gpt-fake" }
  }
}
JSON
  cat >"$OQA_PROJ/.opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${REPO_ROOT}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${FAKE_SERVER_PORT}/v1",
        "timeout": 30000
      },
      "models": {
        "gpt-fake": {
          "tool_call": true,
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  },
  "permission": {
    "team_create": "allow",
    "task": "allow",
    "call_omo_agent": "allow"
  }
}
JSONC
}

tc_assert_jsonl() {
  local run_file="$1"
  local failures=0
  : >"$ASSERTIONS"

  if grep -q '"type":"tool_use"' "$run_file" && grep -q '"tool":"team_create"' "$run_file"; then
    tc_pass "opencode run emitted a team_create tool_use event"
  else
    tc_fail "missing team_create tool_use event"; failures=$((failures+1))
  fi

  if grep -q '"inline_spec"' "$run_file" && grep -q '"lead"' "$run_file" && grep -q '"kind":"category"' "$run_file"; then
    tc_pass "team_create input included the host-style lead skeleton discriminator"
  else
    tc_fail "missing host-style lead skeleton in team_create input"; failures=$((failures+1))
  fi

  if grep -q '"type":"tool_use"' "$run_file" && grep -q '"tool":"team_list"' "$run_file"; then
    tc_pass "opencode run emitted a team_list verification tool_use event"
  else
    tc_fail "missing team_list verification tool_use event"; failures=$((failures+1))
  fi

  if grep -q 'team-create-empty-lead-qa' "$run_file"; then
    tc_pass "team_create result preserved the requested team name"
  else
    tc_fail "missing requested team name in output"; failures=$((failures+1))
  fi

  if grep -q 'requires exactly one of teamName or inline_spec' "$run_file"; then
    tc_fail "team_create returned the stale exactly-one validation error"; failures=$((failures+1))
  else
    tc_pass "team_create did not return the stale exactly-one validation error"
  fi

  return "$failures"
}

rm -f "$RUN_JSONL" "$ASSERTIONS" "$FAKE_LLM_LOG"

oqa_mk_isolated_xdg || exit 1
tc_start_fake_llm || exit 1
tc_write_configs "$XDG_CONFIG_HOME"

(
  cd "$OQA_PROJ" || exit 1
  opencode run --format json --model openai/gpt-fake "TEAM_CREATE_EMPTY_LEAD_QA: call team_create with inline_spec name team-create-empty-lead-qa, lead skeleton { kind: category }, and one category member named worker using category quick and prompt 'Reply DONE'. Then call team_list." >"$RUN_JSONL"
)
run_status=$?
if [ "$run_status" -ne 0 ]; then
  tc_log "opencode run failed with status $run_status"
  exit "$run_status"
fi

tc_assert_jsonl "$RUN_JSONL"
