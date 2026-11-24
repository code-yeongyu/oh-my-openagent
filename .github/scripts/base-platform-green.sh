#!/usr/bin/env bash
# Prints "true" when the latest completed dev push run of ci.yml at BASE_SHA succeeded and ran its macOS/Windows legs
# and every one of them succeeded, else "false"; one stderr line names the run it relied on. A leg that passed without
# running its tests (platform-jobs.jq "no-tests") is not proof. ci-fast-path.mjs reads it as --base-platform-green for a release-state pull request.
#
# env: GH_REPO, BASE_SHA
set -euo pipefail

filter="$(cat "$(dirname "$0")/platform-jobs.jq")"
read -r run_id conclusion <<< "$(gh api "repos/$GH_REPO/actions/workflows/ci.yml/runs?branch=dev&event=push&status=completed&head_sha=$BASE_SHA&per_page=20" \
  --jq '[.workflow_runs[] | select(.head_sha == env.BASE_SHA and .head_branch == "dev" and .event == "push" and .status == "completed")]
    | sort_by(.created_at) | last | "\(.id // "") \(.conclusion // "")"')"
if [ -z "$run_id" ] || [ "$conclusion" != success ]; then
  echo "base-platform-green: no successful completed dev push run at $BASE_SHA (run ${run_id:-none}, ${conclusion:-none})" >&2
  echo false
  exit 0
fi
results="$(gh api "repos/$GH_REPO/actions/runs/$run_id/jobs?filter=latest&per_page=100" --jq "$filter" | cut -f2)"
if [ -n "$results" ] && ! grep -qvx success <<< "$results"; then
  echo "base-platform-green: proof run $run_id at $BASE_SHA ran its macOS/Windows legs green" >&2
  echo true
else
  echo "base-platform-green: run $run_id at $BASE_SHA has a macOS/Windows leg that did not run green" >&2
  echo false
fi
