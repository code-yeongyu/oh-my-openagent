#!/usr/bin/env bash
set -euo pipefail

source=.github/ci-test-timings.json
if [ -n "$TIMINGS_KEY" ]; then
  if [ "$TIMINGS_EXACT_HIT" != true ]; then
    echo "::error::Could not restore the selected shard timing snapshot: $TIMINGS_KEY"
    exit 1
  fi
  source="$RUNNER_TEMP/ci-test-timings.json"
fi
# The receipt parser requires literal paths in the shard commands.
mkdir -p .omo
cp "$source" .omo/ci-shard-record.json
