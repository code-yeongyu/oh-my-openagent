#!/usr/bin/env bash
set -euo pipefail

# LEG_JOB_STATUS lists the result of every macOS job this status reads its parts from (one or two). They share one
# `if`, so they are skipped together; a partial skip is a failure. Otherwise the first result other than success wins.
job_status=""
count=0
skipped=0
for result in $LEG_JOB_STATUS; do
  count=$((count + 1))
  if [ "$result" = "skipped" ]; then
    skipped=$((skipped + 1))
  elif [ "$result" != "success" ] && [ -z "$job_status" ]; then
    job_status="$result"
  fi
done
if [ "$count" -gt 0 ] && [ "$skipped" -eq "$count" ]; then
  job_status=skipped
elif [ "$skipped" -gt 0 ] && [ -z "$job_status" ]; then
  job_status=failure
elif [ "$count" -gt 0 ] && [ -z "$job_status" ]; then
  job_status=success
fi

# An unallocated macOS job is an intended skip only if the classifier agrees.
# Missing/failed classification still fails closed in the existing leg guard.
guard_status="$job_status"
if [ "$guard_status" = "skipped" ]; then guard_status=success; fi
node script/ci-leg-tests-guard.mjs \
  --os "$LEG_OS" --job-status "$guard_status" --outcomes "$TEST_OUTCOMES" \
  --run-heavy "$RUN_HEAVY" --full-matrix "$FULL_MATRIX" --runtime-touching "$RUNTIME_TOUCHING"

if [ "$job_status" = "skipped" ]; then exit 0; fi
# The guard normally relies on the test step itself to fail its job. These steps
# ran in another job, so propagate each required part's outcome explicitly.
for outcome in $TEST_OUTCOMES; do
  if [ "$outcome" != "success" ]; then
    echo "::error::a required part did not succeed: $outcome"
    exit 1
  fi
done
