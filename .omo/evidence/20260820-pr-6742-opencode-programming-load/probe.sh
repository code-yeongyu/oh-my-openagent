#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OQA_COMMON="$REPO_ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"
RUN_FILE="$SCRIPT_DIR/opencode-run.jsonl"
RESULT_FILE="$SCRIPT_DIR/opencode-programming-skill.txt"
FAKE_LOG="$SCRIPT_DIR/fake-provider.txt"

. "$OQA_COMMON"
oqa_require opencode sqlite3 curl jq bun

real_db="$(oqa_db_path)"
sessions_before="$(sqlite3 "$real_db" 'SELECT count(*) FROM session;')"
npm_cache="$(npm config get cache)"

oqa_mk_isolated_xdg
RUN_STDERR="$OQA_XDG_ROOT/opencode-run.stderr"
port_file="$OQA_XDG_ROOT/fake-provider.stdout"
FAKE_LLM_LOG="$FAKE_LOG" bun run --bun "$SCRIPT_DIR/fake-provider.mjs" >"$port_file" 2>&1 &
fake_pid=$!
OQA_CURL_PIDS+=("$fake_pid")

deadline=$(( $(date +%s) + 10 ))
fake_port=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  fake_port="$(sed -n 's/^fake-provider listening on //p' "$port_file" | head -1)"
  [ -n "$fake_port" ] && break
  sleep 0.2
done
if [ -z "$fake_port" ]; then
  cat "$port_file" >&2
  exit 1
fi

mkdir -p "$XDG_CONFIG_HOME/opencode"
npm --prefix "$XDG_CONFIG_HOME/opencode" install --offline --save-exact \
  --cache "$npm_cache" --ignore-scripts --no-audit --no-fund @opencode-ai/plugin@1.18.14 \
  > "$SCRIPT_DIR/dependency-bootstrap.txt"
jq -n \
  --arg plugin "file://$REPO_ROOT/packages/omo-opencode/src/index.ts" \
  --arg base_url "http://127.0.0.1:$fake_port/v1" \
  '{
    plugin: [$plugin],
    model: "openai/gpt-fake",
    provider: {
      openai: {
        options: {apiKey: "fake-key", baseURL: $base_url, timeout: 30000},
        models: {"gpt-fake": {tool_call: true, limit: {context: 200000, output: 8192}}}
      }
    },
    permission: {skill: "allow"}
  }' > "$XDG_CONFIG_HOME/opencode/opencode.json"

(
  cd "$OQA_PROJ"
  opencode run --print-logs --log-level DEBUG --format json 'LOAD_PROGRAMMING_SKILL' \
    > "$RUN_FILE" 2> "$RUN_STDERR"
)

sessions_after="$(sqlite3 "$real_db" 'SELECT count(*) FROM session;')"
tool_status="$(jq -r 'select(.type == "tool_use" and .part.tool == "skill") | .part.state.status' "$RUN_FILE" | tail -1)"
tool_output="$(jq -r 'select(.type == "tool_use" and .part.tool == "skill") | .part.state.output' "$RUN_FILE")"
description_length="$(sed -n 's/^description_length=//p' "$FAKE_LOG" | tail -1)"

{
  printf 'OpenCode version: %s\n' "$(opencode --version)"
  printf 'Surface: isolated opencode run with local plugin and deterministic fake provider\n'
  printf 'Tool call: skill(name=programming)\n'
  printf 'Tool status: %s\n' "$tool_status"
  printf 'Description length: %s bytes\n' "$description_length"
  printf 'Real DB sessions before: %s\n' "$sessions_before"
  printf 'Real DB sessions after: %s\n' "$sessions_after"
  printf 'Tool output prefix:\n%s\n' "$(printf '%s\n' "$tool_output" | sed -n '1,12p')"
} > "$RESULT_FILE"

failures=0
if test "$tool_status" = "completed"; then
  oqa_pass 'OpenCode completed the plugin skill tool call'
else
  oqa_fail "skill tool status is '$tool_status' (expected completed)" || true
  failures=$((failures + 1))
fi
if [[ "$tool_output" == '## Skill: programming'* ]]; then
  oqa_pass 'skill(name=programming) returned the programming skill body'
else
  oqa_fail 'skill(name=programming) did not return the programming skill body' || true
  failures=$((failures + 1))
fi
if grep -Fxq 'tool_output_returned=true' "$FAKE_LOG"; then
  oqa_pass 'OpenCode returned the completed skill output to the provider loop'
else
  oqa_fail 'OpenCode did not return the completed skill output to the provider loop' || true
  failures=$((failures + 1))
fi
if grep -Fxq 'description_prefix_match=true' "$FAKE_LOG"; then
  oqa_pass 'advertised skill-tool metadata contains the scoped programming description'
else
  oqa_fail 'advertised skill-tool metadata lacks the scoped programming description' || true
  failures=$((failures + 1))
fi
if grep -Fxq 'legacy_trigger_present=false' "$FAKE_LOG"; then
  oqa_pass 'advertised skill-tool metadata excludes the legacy overbroad trigger'
else
  oqa_fail 'advertised skill-tool metadata contains the legacy overbroad trigger' || true
  failures=$((failures + 1))
fi
if grep -Fxq 'trigger_context_marker=true' "$FAKE_LOG"; then
  oqa_pass 'advertised topic triggers are explicitly scoped to write/review intent'
else
  oqa_fail 'advertised topic triggers are not scoped to write/review intent' || true
  failures=$((failures + 1))
fi
if test -n "$description_length" && test "$description_length" -le 1024; then
  oqa_pass "programming description is within 1024 bytes ($description_length)"
else
  oqa_fail "programming description length is invalid ('$description_length')" || true
  failures=$((failures + 1))
fi
if test "$sessions_before" = "$sessions_after"; then
  oqa_pass "real OpenCode DB session count is unchanged ($sessions_before)"
else
  oqa_fail "real OpenCode DB session count changed ($sessions_before -> $sessions_after)" || true
  failures=$((failures + 1))
fi

kill "$fake_pid" 2>/dev/null || true
wait "$fake_pid" 2>/dev/null || true
OQA_CURL_PIDS=()
oqa_cleanup
trap - EXIT
exit "$failures"
