# Senpi Windows DAG race determinism

## Root cause and fix

- `createDagManager` already makes the key lookup and the
  `definition_conflict` decision under `withKeyLock`. Its two-process test only
  announced construction readiness, then released the workers. It now requires
  each worker to confirm it consumed a first barrier byte before the parent
  sends the start byte. The test still runs two OS processes and still requires
  one successful start plus one `definition_conflict` for divergent prompts.
- `tryCreateLock` writes lock content to a unique temporary path before an
  exclusive hard-link publishes it. The sentinel test used a synchronous nested
  `withRunLock` call from the first worker's mocked `open`, so the second
  reclaimer could wait while the first writer was intentionally unable to
  continue. The replacement has two OS workers and stream events: the parent
  observes the first worker's post-open state, lets the second reclaimer finish,
  then releases the first. It proves that the sentinel path is absent before
  publication and has a complete owner record at publication. No production
  lock behavior, timeout, sleep, polling loop, or concurrency invariant changed.

## What was tested

- CI run `33580607971` supplied the failing-first Windows evidence: the manager
  assertion received no `definition_conflict`, and the sentinel test timed out
  acquiring the DAG lock.
- `bun test packages/senpi-task/src/dag/store.test.ts --test-name-pattern 'second reclaimer observes sentinel initialization'`
  passed after the event-barrier change.
- `bun test packages/senpi-task/src/dag/manager.test.ts --test-name-pattern 'two OS processes racing the same key with different prompts'`
  passed after the two-phase child barrier change.
- `./node_modules/.bin/tsgo --noEmit -p packages/senpi-task/tsconfig.json`
  passed. The requested `tsgo` executable was not on `PATH`; this invokes the
  workspace-pinned executable directly.
- `bun test packages/senpi-task` passed: 1791 pass, 1 skip, 0 fail.

## Live Senpi QA

- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test` passed before the
  isolated driver runs.
- The isolated `task-e2e.mjs` result failed outside this test-only diff. Its
  identical-base control at `a0dd6cc91f495a66faa57a7653ab61ddf8023199` failed
  the same checks: `followup_revive`, `task_output_peek`, `jsonl_sequence`,
  `resume_revived_resident`, `resume_finished_steerable`, and
  `resume_ttl_not_revived`. Both runs reported no leaked PIDs and
  `realSenpiUntouched: true`; the control establishes that this is not caused by
  this patch.
- The matching real task lane-spill driver passed from this worktree:
  `LANE_SPILL_OUT_DIR=<resolved path>/live-task-lane-spill SENPI_BIN=$(command -v senpi) node packages/omo-senpi/scripts/qa/task-lane-spill-e2e.mjs`.
  It passed spill-to-fallback, global-cap queueing, `real_senpi_untouched`,
  no leaked PIDs, sandbox removal, and terminal child-PID checks. Its final
  result has `realSenpiUntouched: true` and no attributed real-agent changes.

## Artifacts and omissions

- Canonical artifacts are under
  `.omo/evidence/omo-senpi-adapter/20260902-senpi-ci-race-determinism/`.
  Included verdicts cover the isolated failure, identical-base control, and
  passing lane-spill run.
- Raw environment dumps, credentials, and agent transcripts are omitted.

## Why this is sufficient

The focused tests exercise the exact CI regressions with deterministic
cross-process event ordering. The full package gate covers the surrounding DAG
lock and manager contracts. The passing real task driver provides independent
isolated Senpi task-surface proof. Required PR CI remains the authoritative
Windows platform verification.
