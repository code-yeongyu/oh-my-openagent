#!/usr/bin/env bash
# Prints "true" when the latest completed dev push run of ci.yml at BASE_SHA ran its macOS/Windows legs and every one
# of them succeeded, else "false". A leg that passed without running its tests (platform-jobs.jq "no-tests") is not
# proof. ci-fast-path.mjs reads it as --base-platform-green for a release-state pull request.
#
# env: GH_REPO, BASE_SHA
set -euo pipefail

filter="$(cat "$(dirname "$0")/platform-jobs.jq")"
run_id="$(gh api "repos/$GH_REPO/actions/workflows/ci.yml/runs?branch=dev&event=push&status=completed&head_sha=$BASE_SHA&per_page=20" \
  --jq '.workflow_runs | sort_by(.created_at) | last | .id // empty')"
if [ -z "$run_id" ]; then
  echo false
  exit 0
fi
results="$(gh api "repos/$GH_REPO/actions/runs/$run_id/jobs?filter=latest&per_page=100" --jq "$filter" | cut -f2)"
if [ -n "$results" ] && ! grep -qvx success <<< "$results"; then
  echo true
else
  echo false
fi
