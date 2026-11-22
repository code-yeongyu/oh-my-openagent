#!/usr/bin/env bash

# An exact overall-green push is only a candidate. Keep its run attempt so a
# rerun cannot substitute jobs from a different attempt of the same run.
select_green_push() {
  jq -r --arg sha "$1" '
    [
      .workflow_runs[]
      | select(.event == "push" and .head_sha == $sha and .status == "completed" and .conclusion == "success")
    ]
    | sort_by(.created_at, .id)
    | last
    | select((.id | type) == "number" and (.run_attempt | type) == "number")
    | [.id, .run_attempt] | @tsv
  '
}

require_push_validation() {
  local repo="$1" run="$2" id attempt jobs missing
  IFS=$'\t' read -r id attempt <<< "$run"
  if ! [[ "$id" =~ ^[1-9][0-9]*$ && "$attempt" =~ ^[1-9][0-9]*$ ]]; then
    echo "::error::Missing or invalid CI run attempt for release push proof." >&2
    return 1
  fi
  if ! jobs="$(gh api --paginate --slurp "repos/${repo}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100")"; then
    echo "::error::Cannot read validation jobs for push CI run ${id}, attempt ${attempt}." >&2
    return 1
  fi

  # Like platform-jobs.jq, look through job success to the actual work.
  # Use named validation steps: setup and status-only jobs do not test anything.
  missing="$(jq -rs '
    if length != 1 or (.[0] | type) != "array" then error("expected paginated CI jobs") else .[0] end
    | [.[].jobs[]] as $jobs
    | {
        "typecheck": ["Type check", "Lint", "Lint ratchet", "Dead-code check (knip)"],
        "test-linux (omo-opencode)": ["Run vendored lsp-daemon tests", "Run omo-opencode tests", "Run the serial quarantine"],
        "test-linux (memory-core)": ["Run memory-core tests in a PID namespace"],
        "test-linux (remainder-1)": ["Run the first remainder half"],
        "test-linux (remainder-2)": ["Run the second remainder half"],
        "test (windows-latest, 1/2)": ["Run vendored lsp-daemon tests", "Run tests with Windows telemetry"],
        "test (windows-latest, 2/2)": ["Run tests"],
        "macos-combined": ["Run vendored lsp-daemon tests", "Run root test shard 1", "Run root test shard 2 heavy", "Run root test shard 2 light"]
      }
    | to_entries[] as $required
    | select(any($jobs[];
        .name == $required.key and .status == "completed" and .conclusion == "success"
        and (.steps as $steps | all($required.value[]; . as $step |
          any($steps[]?; .name == $step and .status == "completed" and .conclusion == "success")
        ))
      ) | not)
    | $required.key
  ' <<< "$jobs")" || return 1
  if [ -n "$missing" ]; then
    echo "::error::Push CI run ${id}, attempt ${attempt} lacks successful required validation: $(paste -sd ',' <<< "$missing")." >&2
    return 1
  fi
}
