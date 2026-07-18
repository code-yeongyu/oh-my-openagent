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
DB_ISOLATION="$SCRIPT_DIR/db-isolation.txt"
ORIG_HOME="${HOME:-}"
ORIG_XDG_DATA_HOME="${XDG_DATA_HOME:-}"
ORIG_XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-}"
ORIG_XDG_CACHE_HOME="${XDG_CACHE_HOME:-}"
ORIG_XDG_STATE_HOME="${XDG_STATE_HOME:-}"
ORIG_XDG_DATA_HOME_SET=0; [ "${XDG_DATA_HOME+x}" = x ] && ORIG_XDG_DATA_HOME_SET=1
ORIG_XDG_CONFIG_HOME_SET=0; [ "${XDG_CONFIG_HOME+x}" = x ] && ORIG_XDG_CONFIG_HOME_SET=1
ORIG_XDG_CACHE_HOME_SET=0; [ "${XDG_CACHE_HOME+x}" = x ] && ORIG_XDG_CACHE_HOME_SET=1
ORIG_XDG_STATE_HOME_SET=0; [ "${XDG_STATE_HOME+x}" = x ] && ORIG_XDG_STATE_HOME_SET=1

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

tc_real_opencode() {
  local -a env_cmd
  env_cmd=(env)
  if [ "$ORIG_XDG_DATA_HOME_SET" -eq 0 ]; then env_cmd+=(-u XDG_DATA_HOME); fi
  if [ "$ORIG_XDG_CONFIG_HOME_SET" -eq 0 ]; then env_cmd+=(-u XDG_CONFIG_HOME); fi
  if [ "$ORIG_XDG_CACHE_HOME_SET" -eq 0 ]; then env_cmd+=(-u XDG_CACHE_HOME); fi
  if [ "$ORIG_XDG_STATE_HOME_SET" -eq 0 ]; then env_cmd+=(-u XDG_STATE_HOME); fi
  env_cmd+=("HOME=$ORIG_HOME")
  if [ "$ORIG_XDG_DATA_HOME_SET" -eq 1 ]; then env_cmd+=("XDG_DATA_HOME=$ORIG_XDG_DATA_HOME"); fi
  if [ "$ORIG_XDG_CONFIG_HOME_SET" -eq 1 ]; then env_cmd+=("XDG_CONFIG_HOME=$ORIG_XDG_CONFIG_HOME"); fi
  if [ "$ORIG_XDG_CACHE_HOME_SET" -eq 1 ]; then env_cmd+=("XDG_CACHE_HOME=$ORIG_XDG_CACHE_HOME"); fi
  if [ "$ORIG_XDG_STATE_HOME_SET" -eq 1 ]; then env_cmd+=("XDG_STATE_HOME=$ORIG_XDG_STATE_HOME"); fi
  "${env_cmd[@]}" opencode "$@"
}

tc_real_session_count() {
  tc_real_opencode db "SELECT count(*) FROM session" --format json \
    | bun -e 'const input = await Bun.stdin.text(); const rows = JSON.parse(input); console.log(Object.values(rows[0] ?? {})[0] ?? "")'
}

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

  if RUN_FILE="$run_file" bun -e '
    const lines = (await Bun.file(process.env.RUN_FILE).text()).trim().split(/\n+/).filter(Boolean)
    const events = lines.map((line) => JSON.parse(line))
    const teamCreate = events.find((event) => event.type === "tool_use" && event.part?.tool === "team_create")
    process.exit(teamCreate ? 0 : 1)
  '; then
    tc_pass "opencode run emitted a team_create tool_use event"
  else
    tc_fail "missing team_create tool_use event"; failures=$((failures+1))
  fi

  if RUN_FILE="$run_file" bun -e '
    const lines = (await Bun.file(process.env.RUN_FILE).text()).trim().split(/\n+/).filter(Boolean)
    const events = lines.map((line) => JSON.parse(line))
    const teamCreate = events.find((event) => event.type === "tool_use" && event.part?.tool === "team_create")
    const lead = teamCreate?.part?.state?.input?.inline_spec?.lead
    const ok = lead?.kind === "category"
      && lead?.category === ""
      && lead?.subagent_type === ""
      && lead?.prompt === ""
      && Array.isArray(lead?.loadSkills)
      && lead.loadSkills.length === 0
    process.exit(ok ? 0 : 1)
  '; then
    tc_pass "team_create input included the host-style lead skeleton discriminator"
  else
    tc_fail "missing host-style lead skeleton in team_create input"; failures=$((failures+1))
  fi

  if RUN_FILE="$run_file" bun -e '
    const lines = (await Bun.file(process.env.RUN_FILE).text()).trim().split(/\n+/).filter(Boolean)
    const events = lines.map((line) => JSON.parse(line))
    const teamList = events.find((event) => event.type === "tool_use" && event.part?.tool === "team_list")
    process.exit(teamList ? 0 : 1)
  '; then
    tc_pass "opencode run emitted a team_list verification tool_use event"
  else
    tc_fail "missing team_list verification tool_use event"; failures=$((failures+1))
  fi

  if RUN_FILE="$run_file" bun -e '
    const lines = (await Bun.file(process.env.RUN_FILE).text()).trim().split(/\n+/).filter(Boolean)
    const events = lines.map((line) => JSON.parse(line))
    const teamCreate = events.find((event) => event.type === "tool_use" && event.part?.tool === "team_create")
    const output = JSON.parse(teamCreate?.part?.state?.output ?? "{}")
    process.exit(output?.runtimeState?.teamName === "team-create-empty-lead-qa" ? 0 : 1)
  '; then
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

rm -f "$RUN_JSONL" "$ASSERTIONS" "$FAKE_LLM_LOG" "$DB_ISOLATION"

REAL_DB_PATH_BEFORE="$(tc_real_opencode db path)" || exit 1
REAL_SESSION_COUNT_BEFORE="$(tc_real_session_count)" || exit 1

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

SANDBOX_DB_PATH="$(opencode db path)" || exit 1
REAL_DB_PATH_AFTER="$(tc_real_opencode db path)" || exit 1
REAL_SESSION_COUNT_AFTER="$(tc_real_session_count)" || exit 1

{
  printf 'real_db_query=%s\n' 'SELECT count(*) FROM session'
  printf 'real_db_path_before=%s\n' "$REAL_DB_PATH_BEFORE"
  printf 'real_session_count_before=%s\n' "$REAL_SESSION_COUNT_BEFORE"
  printf 'sandbox_xdg_data_home=%s\n' "$XDG_DATA_HOME"
  printf 'sandbox_db_path=%s\n' "$SANDBOX_DB_PATH"
  printf 'real_db_path_after=%s\n' "$REAL_DB_PATH_AFTER"
  printf 'real_session_count_after=%s\n' "$REAL_SESSION_COUNT_AFTER"
  printf 'real_db_path_stable=%s\n' "$([ "$REAL_DB_PATH_BEFORE" = "$REAL_DB_PATH_AFTER" ] && printf yes || printf no)"
  printf 'real_session_count_unchanged=%s\n' "$([ "$REAL_SESSION_COUNT_BEFORE" = "$REAL_SESSION_COUNT_AFTER" ] && printf yes || printf no)"
  printf 'sandbox_db_distinct_from_real=%s\n' "$([ "$SANDBOX_DB_PATH" != "$REAL_DB_PATH_AFTER" ] && printf yes || printf no)"
} >"$DB_ISOLATION"

tc_assert_jsonl "$RUN_JSONL" || exit $?

qa_failures=0
if [ "$REAL_DB_PATH_BEFORE" = "$REAL_DB_PATH_AFTER" ]; then
  tc_pass "real OpenCode DB path was stable before and after isolated run"
else
  tc_fail "real OpenCode DB path changed during isolated run"; qa_failures=$((qa_failures+1))
fi

if [ "$REAL_SESSION_COUNT_BEFORE" = "$REAL_SESSION_COUNT_AFTER" ]; then
  tc_pass "real OpenCode DB session count was unchanged before and after isolated run"
else
  tc_fail "real OpenCode DB session count changed during isolated run"; qa_failures=$((qa_failures+1))
fi

if [ "$SANDBOX_DB_PATH" != "$REAL_DB_PATH_AFTER" ]; then
  tc_pass "isolated run used a sandbox OpenCode DB path distinct from the real DB"
else
  tc_fail "isolated run used the real OpenCode DB path"; qa_failures=$((qa_failures+1))
fi

exit "$qa_failures"
