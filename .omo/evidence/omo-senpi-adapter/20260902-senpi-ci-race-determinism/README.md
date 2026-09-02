# Live Senpi task QA

## What was tested

`node packages/omo-senpi/scripts/qa/drive.mjs --self-test` passed. The isolated
`task-e2e.mjs` run and an identical-base control both reported the same unrelated
scenario failures. The control was `a0dd6cc91f495a66faa57a7653ab61ddf8023199`,
the unmodified base of this branch.

The required passing real task surface was then driven with:

```sh
LANE_SPILL_OUT_DIR=<this directory>/live-task-lane-spill \
SENPI_BIN=/Users/sungsoopark/.local/bin/senpi \
node packages/omo-senpi/scripts/qa/task-lane-spill-e2e.mjs
```

## What was observed

`live-task-lane-spill/verdict.json` reports `result: "PASS"` for both
lane-spill scenarios, `realSenpiUntouched: true`, an empty
`realSenpiChangedPaths`, no leaked PIDs, removed sandboxes, and terminal child
PIDs. The isolated failing run and its same-base control are retained as
`live-task-isolated/verdict.json` and
`live-task-origin-dev-control/verdict.json`; their identical failed checks are
not attributed to this test-only patch.

## Why this is enough

The lane-spill driver exercises real Senpi child-task admission and concurrency
with isolation and cleanup proof. It supplies the passing real task surface
while the exact task-E2E failure is controlled against the unchanged base.

## What was omitted

Raw environment snapshots and credential-bearing material are not copied here.
