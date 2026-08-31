# Issue #7544 RPC-child reconciliation guard

## What was tested

- Deterministic failing-first test:
  - `bunx bun@1.4.0 test ./packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts -t "RPC child marker"`
- P1 failing-first boundary tests:
  - parent sessions with `SENPI_CODING_AGENT_SESSION_DIR` still reconcile and
    still run process hygiene;
  - only `OMO_SENPI_TASK_RPC_CHILD=1` suppresses parent-only reconciliation,
    notification, and process hygiene;
  - the RPC spawn descriptor always sets that marker after member overrides.
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
- Final P1 `test:senpi` passed with 2464 tests, one Windows platform skip,
  0 failures, and 7913 assertions across 327 files. The evidence resolver
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
- P1 remediation reran the real adapter and task surfaces:
  - adapter result `PASS`, protected Senpi/OMO paths unchanged, credential
    digest unchanged;
  - task main exit `0`, exactly one child extension marker, extension
    suppression `PASS`, resume-child setup `PASS`, real Senpi untouched, and
    leaked PID count `0`;
  - seven broader revive/output/sequence assertions remain outside this
    dedicated-marker boundary and are disclosed in
    `p1-live-task.redacted.json`.
- After merging current `upstream/dev@ee7ae5d66`, all changed-input checks
  were repeated:
  - focused boundary/adjacent suites passed 42/42 with 101 assertions;
  - adapter TypeScript diagnostics passed;
  - full Senpi gate passed 2464 tests with one Windows skip, 0 failures,
    7913 assertions across 327 files, plus evidence resolver 10/10;
  - real adapter returned `PASS` with zero observed or protected Senpi/OMO
    path changes;
  - real task issue observables remained `PASS`: one child extension marker,
    main exit `0`, resume-child and parent-suspension checks, real-home
    isolation, and leaked PID count `0`.

## Why this is enough

The failing-first test executes the actual event bridge and records the exact
call that recursively reattached persisted resident tasks. Its order assertion
guards the adjacent startup responsibilities that RPC children still need.
The generated bundle, package gate, and real Senpi runs cover distribution and
runtime wiring. The live task driver's single marker and zero leaked PIDs are
the closest real-surface observables for the reported process-storm regression;
the unrelated lifecycle failures do not execute the new marker guard.
The P1 parent-override cases additionally prove that top-level sandboxed or
resumed parents retain reconciliation and process hygiene, while the spawn
descriptor and real child marker prove only RPC children suppress those
parent-owned actions.

## Cleanup

- Removed the adapter sandbox plus all nine task-driver sandboxes.
- Verified all ten P1 sandbox tokens were absent after cleanup.
- Removed the raw P1 task-driver directory after recording the redacted
  reviewer artifact.
- Removed the task-owned isolated Bun 1.4.0 cache.
- Verified no process referenced any P1 sandbox token.
- Task-driver `leakedPids=0`.
- After the current-dev rerun, removed another ten task-owned sandboxes, the
  raw merged-base task-driver directory, and the second isolated Bun cache.
- Terminated the task-owned LSP daemon, language server, and tsserver tree
  observed after the live adapter run; verified all three PIDs absent.

## Final OpenCode-only upstream refresh

`upstream/dev` advanced to `00fc6bdb8`. Its handwritten Senpi delta is the
LSP document-URI normalization; the generated main `omo.js` bundle also
changed. The final merged tree was rebuilt and tested with CI Bun 1.4.0.

- dedicated-marker boundary and adjacent suites: 42 pass, 0 fail,
  101 assertions;
- `senpi-task` and adapter TypeScript diagnostics: pass;
- full Senpi gate: 2464 pass, one Windows-only skip, 0 fail, 7913 assertions
  across 327 files; evidence resolver 10 pass, 0 fail;
- all six generated extensions and staged runtimes: current under Bun 1.4.0;
- adapter-driver and task-RPC-driver self-tests: pass;
- real isolated adapter: `result=PASS`, protected Senpi/OMO paths empty,
  credential digest unchanged, and unrelated concurrent volatile session
  writes redacted in `final-live-adapter.json`;
- real task surface: one child extension marker, main exit 0, all
  issue-relevant spawn/suppression/resume/isolation checks passed, and leaked
  PID count 0. The same six unrelated revive/output/sequence assertions remain
  disclosed in `final-live-task.redacted.json`.

## Nested RPC-agent recovery follow-up

A later review identified that a persistent RPC-child marker also suppressed
recovery after the RPC agent had a captured session and owned descendant
tasks. Only a marked process without a captured session needs to skip the
unsafe legacy global sweep.

- failing-first captured-session test: failed because reconciliation received
  no call instead of `rpc-agent-session`;
- smallest fix: skip reconciliation only when the RPC marker is set and the
  captured session ID is absent;
- identical focused test: 1 pass, 0 fail, 4 assertions;
- lifecycle/process-sweep/RPC-spawn suites: 43 pass, 0 fail, 105 assertions;
- both package TypeScript checks: pass;
- Bun 1.4.0 canonical six-bundle build and freshness: pass;
- full Senpi gate: 2465 pass, one Windows-only skip, 0 fail, 7917 assertions
  across 327 files; evidence resolver 10 pass, 0 fail;
- real adapter: pass with protected Senpi/OMO state and credential digest
  unchanged;
- real process-task surface: one RPC child marker, main exit 0, all
  issue-relevant isolation/spawn/resume checks passed, and leaked PID count 0.
  The same six unrelated lifecycle assertions remain disclosed, not hidden.

Reviewer-safe machine details are in `nested-rpc-recovery.redacted.json`.

## What was omitted

No credentials, provider tokens, authentication headers, environment dumps,
absolute machine paths, private local configuration, or unrelated session
content are included.
