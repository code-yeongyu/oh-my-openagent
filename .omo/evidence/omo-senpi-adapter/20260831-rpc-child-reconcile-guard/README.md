# Issue #7544 RPC-child reconciliation guard

## What was tested

- Deterministic failing-first test:
  - `bunx bun@1.4.0 test ./packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts -t "RPC child marker"`
- Adjacent recovery and process-sweep tests:
  - `bunx bun@1.4.0 test ./packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts ./packages/omo-senpi/src/components/task/process-sweep.test.ts`
- Generated Senpi extension bundle with the CI Bun 1.4.0 runtime.
- Adapter tsgo and the full `test:senpi` compatibility gate.
- Senpi QA adapter-driver and task-RPC-driver self-tests.
- Real isolated Senpi adapter driver.
- Real task lifecycle driver:
  - `TASK_E2E_OUT_DIR="$ev/live-task-rpc" SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs`

## What was observed

- RED: the RPC marker was set, but `reconcileOnSessionStart` still received
  `parent-session`.
- GREEN: the identical command passed. Reconciliation and parent notification
  were skipped while the remaining session-start chain stayed active.
- Adjacent focused suites passed 16/16.
- Adapter tsgo passed.
- Full `test:senpi` passed with 2462 tests, one Windows platform skip,
  0 failures, and 7910 assertions across 327 files. The evidence resolver
  passed 10/10.
- Both QA driver self-tests passed.
- The real adapter driver returned `PASS`, injected ultrawork, passed comment
  checking, attributed no real-home changes, changed no protected paths, and
  left the real credential digest unchanged.
- The task driver exited 0. Its issue-relevant checks passed:
  `extension_suppression`, `spawn_background`, `resume_spawn_children`,
  `real_senpi_untouched`, and `no_leaked_pids`. It observed exactly one child
  extension marker, the main task completed, and no descendant process leaked.
- The task driver's aggregate verdict remained `FAIL` because ten current
  revive/output/sequence assertions outside session-start reconciliation
  failed. They are preserved in `live-task-rpc/verdict.redacted.json`; no
  assertion was weakened or hidden.

## Why this is enough

The failing-first test executes the actual event bridge and records the exact
call that recursively reattached persisted resident tasks. Its order assertion
guards the adjacent startup responsibilities that RPC children still need.
The generated bundle, package gate, and real Senpi runs cover distribution and
runtime wiring. The live task driver's single marker and zero leaked PIDs are
the closest real-surface observables for the reported process-storm regression;
the unrelated lifecycle failures do not execute the new marker guard.

## Cleanup

- Removed the adapter sandbox plus all nine task-driver sandboxes.
- Verified no `omo-senpi-qa-*` directory remained under the temporary root.
- Verified no process referenced any task-owned sandbox token.
- Task-driver `leakedPids=0`.

## What was omitted

No credentials, provider tokens, authentication headers, environment dumps,
absolute machine paths, private local configuration, or unrelated session
content are included.
