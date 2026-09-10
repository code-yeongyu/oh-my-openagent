# QA-only shell adapter. Product and skill files remain unchanged.
# The original helper polls a log with sleep. Intercept its source operation
# and replace only mock readiness with a bounded FIFO read of MOCK_LISTENING.
function .() {
  builtin . "$@"
  if [[ "$1" == */codex-qa/scripts/lib/common.sh ]]; then
    cqa_start_mock() {
      local ready log marker port
      ready="$CQA_HOME_ROOT/mock-ready.fifo"
      log="$CQA_HOME_ROOT/mock-stderr.log"
      mkfifo "$ready" || return 1
      exec 3<> "$ready"
      node "$REPO_ROOT/.agents/skills/codex-qa/scripts/lib/mock-model.mjs" >"$ready" 2>"$log" &
      CQA_MOCK_PID=$!
      CQA_PIDS+=("$CQA_MOCK_PID")
      if ! read -r -t 10 marker port <&3; then
        exec 3>&-
        cqa_fail "mock readiness deadline exceeded; stderr: $(<"$log")"
        return 1
      fi
      exec 3>&-
      if [ "$marker" != MOCK_LISTENING ] || [[ ! "$port" =~ ^[0-9]+$ ]]; then
        cqa_fail "invalid mock readiness event: $marker $port"
        return 1
      fi
      export MOCK_PORT="$port"
      cqa_log "mock readiness received via FIFO: $marker $port"
    }
  fi
}
