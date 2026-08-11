#!/usr/bin/env bash
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
evidence_dir="$(cd "$(dirname "$0")" && pwd)"
skill_dir="$repo/.agents/skills/opencode-qa"
real_db="$(opencode db path)"
before="$(sqlite3 "$real_db" 'SELECT count(*) FROM session')"

(
  source "$skill_dir/scripts/lib/common.sh"
  oqa_mk_isolated_xdg
  port="$(oqa_free_port)"
  mkdir -p "$XDG_CONFIG_HOME/opencode" "$OQA_PROJ"
  cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<JSON
{
  "provider": {
    "openai": {
      "options": { "baseURL": "http://127.0.0.1:$port/v1", "apiKey": "qa-only" },
      "models": { "mock-1": { "name": "Mock One" } }
    }
  }
}
JSON
  FAKE_OPENAI_PORT="$port" FAKE_LLM_LOG="$evidence_dir/fake-provider.log" \
    node "$skill_dir/scripts/lib/fake-openai-server.mjs" > "$evidence_dir/fake-provider.stdout.log" 2> "$evidence_dir/fake-provider.stderr.log" &
  fake_pid=$!
  trap 'kill "$fake_pid" 2>/dev/null || true' EXIT
  oqa_wait_http "http://127.0.0.1:$port/health" "" 10

  cd "$OQA_PROJ"
  opencode run --model openai/mock-1 --format json 'Reply with the fake-provider completion.' \
    > "$evidence_dir/opencode-run.jsonl" 2> "$evidence_dir/opencode-run.stderr.log"
  jq -e 'select(.type == "text" and (.part.text | contains("fake response")))' "$evidence_dir/opencode-run.jsonl" \
    > "$evidence_dir/opencode-run-text-event.json"
)

after_run="$(sqlite3 "$real_db" 'SELECT count(*) FROM session')"
printf 'real_db=%s\nsessions_before=%s\nsessions_after=%s\nunchanged=%s\n' \
  "$real_db" "$before" "$after_run" "$([ "$before" = "$after_run" ] && echo true || echo false)" \
  > "$evidence_dir/session-isolation-proof.txt"
test "$before" = "$after_run"

(
  source "$skill_dir/scripts/lib/common.sh"
  oqa_mk_isolated_xdg
  mkdir -p "$XDG_CONFIG_HOME/opencode" "$OQA_PROJ"
  printf '{ "plugin": ["file://%s/packages/omo-opencode/src/index.ts"] }\n' "$repo" > "$XDG_CONFIG_HOME/opencode/opencode.json"
  cd "$OQA_PROJ"
  bun "$repo/packages/omo-opencode/src/cli/index.ts" doctor --json > "$evidence_dir/doctor-missing-cache.json"
)
jq -e '.. | strings? | select(contains("models.json"))' "$evidence_dir/doctor-missing-cache.json" > "$evidence_dir/doctor-model-cache-path.txt"
