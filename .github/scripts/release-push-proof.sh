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

# The stamp inherits these validation steps, not their summary/status jobs.
# Keep the contract in this file: publish may source it alone from the dispatch SHA.
release_validation_contract() {
  cat <<'JSON'
{
  "typecheck": ["Verify @types/node resolves from omo-senpi", "Type check", "Lint", "Lint ratchet", "Dead-code check (knip)"],
  "test-linux (omo-opencode)": ["Run vendored lsp-daemon tests", "Run omo-opencode tests", "Run the serial quarantine"],
  "test-linux (memory-core)": ["Run memory-core tests in a PID namespace"],
  "test-linux (remainder-1)": ["Run the first remainder half"],
  "test-linux (remainder-2)": ["Run the second remainder half"],
  "test (ubuntu-latest, 1/2)": ["Verify root shard coverage"],
  "test (ubuntu-latest, 2/2)": ["Verify root shard coverage"],
  "test (windows-latest, 1/2)": ["Run vendored lsp-daemon tests", "Run tests with Windows telemetry"],
  "test (windows-latest, 2/2)": ["Run vendored lsp-daemon tests", "Run tests"],
  "macos-combined": ["Run vendored lsp-daemon tests", "Run root test shard 1", "Run root test shard 2 heavy", "Run root test shard 2 light", "Run Codex platform smoke", "Run Senpi compatibility tests"],
  "codex-compatibility (ubuntu-latest, full)": ["Run full Codex compatibility suite", "Run omo-codex component checks and tests"],
  "codex-compatibility (windows-latest, platform)": ["Build Codex platform smoke prerequisites", "Run Codex platform smoke tests (.mjs via node --test)", "Run Codex platform smoke tests (.ts via bun test)"],
  "senpi-compatibility (windows-latest)": ["Run Senpi compatibility tests with Windows telemetry"],
  "senpi-tests-linux (one)": ["Run Senpi compatibility tests"],
  "senpi-tests-linux (two)": ["Run Senpi compatibility tests"],
  "senpi-compatibility (ubuntu-latest)": ["Verify Senpi shard coverage"],
  "senpi-bundle-check": ["Verify committed Senpi plugin bundle is current"],
  "senpi-eq": ["Run omo fused-path equivalence (EQ.omo E21-E24)"],
  "native-binary-parity (macos-15, darwin-arm64, aarch64-apple-darwin, omo-darwin-arm64, true)": ["Compare the binary with the npm launcher"],
  "native-binary-parity (windows-latest, windows-x64, x86_64-pc-windows-msvc, omo-windows-x64.exe, f...": ["Run the binary from an empty download folder twice"],
  "build": ["Build", "Verify build output", "Verify generated schema artifacts are committed", "Verify dist bundle tests"],
  "omo-ai-payload-check": ["Verify omo-ai payload", "Verify packed omo-ai consumer", "Dry-run publish"]
}
JSON
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
  missing="$(jq -rs --argjson contract "$(release_validation_contract)" '
    # Exact job/step exceptions for ci.yml branches that do not apply on this leg.
    # Only a completed skip can use an exception, never failure, neutral or cancellation.
    def allowed_skips($j):
      {
        # Codex: the Linux full suite and Windows platform suite run on different legs.
        "codex-compatibility (ubuntu-latest, full)": ["Build Codex platform smoke prerequisites", "Run Codex platform smoke tests (.mjs via node --test)", "Run Codex platform smoke tests (.ts via bun test)"],
        "codex-compatibility (windows-latest, platform)": ["Run full Codex compatibility suite", "Run omo-codex component checks and tests"],
        # Windows does not use the POSIX cache. Telemetry and git diagnostics belong to shard 1; the plain test step belongs to shard 2.
        "test (windows-latest, 1/2)": ["Run actions/cache@v6", "Run tests"],
        "test (windows-latest, 2/2)": ["Run actions/cache@v6", "Run tests with Windows telemetry", "Collect timed-out git evidence", "Upload timed-out git evidence"],
        # Linux matrix: each shard runs its own install/test commands. Only remainder shards produce coverage records and consume optional timing snapshots.
        "test-linux (memory-core)": ["Install dependencies", "Run vendored lsp-daemon tests", "Run omo-opencode tests", "Run the serial quarantine", "Restore selected shard timing snapshot", "Copy the timing snapshot for this shard", "Run the first remainder half", "Run the second remainder half", "Upload root shard record"],
        "test-linux (omo-opencode)": ["Install memory-core test dependencies", "Run memory-core tests in a PID namespace", "Restore selected shard timing snapshot", "Copy the timing snapshot for this shard", "Run the first remainder half", "Run the second remainder half", "Upload root shard record"],
        "test-linux (remainder-1)": ["Install memory-core test dependencies", "Run vendored lsp-daemon tests", "Run omo-opencode tests", "Run the serial quarantine", "Run memory-core tests in a PID namespace", "Run the second remainder half", "Restore selected shard timing snapshot"],
        "test-linux (remainder-2)": ["Install memory-core test dependencies", "Run vendored lsp-daemon tests", "Run omo-opencode tests", "Run the serial quarantine", "Run memory-core tests in a PID namespace", "Run the first remainder half", "Restore selected shard timing snapshot"],
        # Timing data optimizes partitioning but is not required for the Senpi tests.
        "senpi-tests-linux (one)": ["Restore selected shard timing snapshot"],
        "senpi-tests-linux (two)": ["Restore selected shard timing snapshot"],
        # Standalone parity: macOS compares against npm; Windows exercises empty-folder launches. Uploads are failure diagnostics.
        "native-binary-parity (macos-15, darwin-arm64, aarch64-apple-darwin, omo-darwin-arm64, true)": ["Run the binary from an empty download folder twice", "Upload parity runs"],
        "native-binary-parity (windows-latest, windows-x64, x86_64-pc-windows-msvc, omo-windows-x64.exe, f...": ["Build the keychain helper the binary embeds", "Compare the binary with the npm launcher", "Upload parity runs"]
      }[$j] // [];
    if length != 1 or (.[0] | type) != "array" then error("expected paginated CI jobs") else .[0] end
    | [.[].jobs[]] as $jobs
    | $contract
    | to_entries[] as $required
    | select(any($jobs[];
        .name == $required.key and .status == "completed" and .conclusion == "success"
        and all(.steps[]?; .status == "completed" and
          (.conclusion == "success" or (.conclusion == "skipped" and
            (.name as $n | allowed_skips($required.key) | index($n) != null))))
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
