#!/usr/bin/env bash
set -euo pipefail

# An unallocated combined job is an intended skip only if the classifier agrees.
# Missing/failed classification still fails closed in the existing leg guard.
guard_status="$LEG_JOB_STATUS"
if [ "$guard_status" = "skipped" ]; then guard_status=success; fi
node script/ci-leg-tests-guard.mjs \
  --os "$LEG_OS" --job-status "$guard_status" --outcomes "$TEST_OUTCOMES" \
  --run-heavy "$RUN_HEAVY" --full-matrix "$FULL_MATRIX" --runtime-touching "$RUNTIME_TOUCHING"

if [ "$LEG_JOB_STATUS" = "skipped" ]; then exit 0; fi
# The guard normally relies on the test step itself to fail its job. These steps
# ran in another job, so propagate each required part's outcome explicitly.
for outcome in $TEST_OUTCOMES; do
  if [ "$outcome" != "success" ]; then
    echo "::error::macOS part did not succeed: $outcome"
    exit 1
  fi
done
