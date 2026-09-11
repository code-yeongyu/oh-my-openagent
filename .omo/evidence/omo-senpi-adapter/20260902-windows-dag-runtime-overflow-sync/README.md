# Windows DAG runtime overflow synchronization QA

## What was tested

- Failing-first evidence from GitHub Actions run `33605988668`, Windows Senpi job `100170026847`.
- Focused configured-ring regression with CI-pinned Bun 1.4.0:
  `bun test packages/omo-senpi/src/components/task/dag-runtime-config.test.ts`.
- Adjacent DAG runtime and journal behavior with CI-pinned Bun 1.4.0:
  `bun test packages/omo-senpi/src/components/task/dag-runtime-config.test.ts packages/omo-senpi/src/components/task/dag-runtime.test.ts packages/senpi-task/src/dag/journal.test.ts`.
- Adapter and task-engine typechecks with CI-pinned Bun 1.4.0:
  `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json` and `bun x tsgo --noEmit -p packages/senpi-task/tsconfig.json`.
- Mandatory Senpi package gate with CI-pinned Bun 1.4.0:
  `bun run test:senpi`.
- Senpi QA driver self-test and real isolated adapter run:
  `node packages/omo-senpi/scripts/qa/drive.mjs --self-test` and `node packages/omo-senpi/scripts/qa/drive.mjs`.
- A live task driver was also run. Its unrelated baseline failures and concurrent parent-session writes are recorded below, not used as evidence for this test-only repair.

## What was observed

The source CI log states two distinct timing facts: Bun emitted `^ this test timed out after 5000ms.`; the runner's final case line reported `[6459.54ms]`, including delayed termination and cleanup after that timeout. The test waited for an overflow created only by an implicit one-node scheduler startup burst. Ubuntu and macOS passed in the same run.

The repair creates an explicit two-node admission burst before the scheduler awaits either controlled child. The child start gate holds that known state until the already-subscribed RPC sink receives the overflow; the test then releases and completes both children. The assertions still require a positive dropped count, the expected recovery cursor, shipped RPC delivery, and the exact durable WAL event.

The focused test passed: 1 pass, 0 fail, 3 expectations. The adjacent suite passed: 30 pass, 0 fail, 115 expectations. Both typechecks exited 0 without diagnostics. The full package gate passed: 2530 pass, 1 documented Windows process-mode skip, 0 fail, 8063 expectations, 2531 tests across 334 files. Its evidence resolver suite also passed: 10 pass, 0 fail, 31 expectations.

The committed complete driver result records `PASS`, `ultraworkInjected: true`, `commentChecker: PASS`, `realSenpiUntouched: true`, `realOmoUntouched: true`, no changed real-home paths, protected state file names, both real homes checked, and the isolated `sandboxAgentDir` and `sandboxCwd`. The driver removed its own sandbox. The task driver reported all spawned PIDs gone; its nine task-owned sandbox roots were then removed and verified absent.

The optional task lifecycle driver returned `FAIL` on existing checks `followup_revive`, `task_output_peek`, `jsonl_sequence`, `resume_revived_resident`, `resume_finished_steerable`, and `resume_ttl_not_revived`. This PR has no runtime-source diff, and the driver simultaneously observed writes from the active parent Senpi session. Its raw transcripts are intentionally retained only in the ignored task evidence directory because they contain session metadata. This result is not used to claim task-lifecycle success.

## Why this is enough

The focused regression owns the exact scheduler state that previously depended on microtask timing, and it keeps both end-to-end contract assertions: the RPC event is shipped and the matching overflow is durable. The nearby runtime and journal suites cover forwarding, recovery, and ring backpressure. The full package gate is green on the same Bun release used by CI. The real driver proves the packaged adapter loads in a fresh isolated Senpi directory without changing either real home. PR CI with `ci:full-matrix` is the authoritative Windows rerun.

## What was omitted

No credentials, auth headers, environment dumps, or raw parent-session transcripts are committed. The full raw package-gate log and the optional task-driver transcript remain in the canonical ignored evidence directory for this task. The committed files retain command summaries, clean driver results, and cleanup proof only.
