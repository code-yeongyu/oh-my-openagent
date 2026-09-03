WHAT WAS TESTED
- ./node_modules/.bin/tsgo --noEmit -p packages/omo-senpi/tsconfig.json
- Focused polling guard, RPC codec/bridge, RPC snapshot, and session-compaction lifecycle tests.
- node packages/omo-senpi/scripts/qa/drive.mjs --self-test
- node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test
- node packages/omo-senpi/plugin/scripts/build-extension.mjs --check
- Live two-turn task-output driver with the installed workspace Senpi binary: SENPI_BIN=node_modules/.bin/senpi TASK_E2E_SCOPE=task-output TASK_E2E_OUT_DIR=<resolved evidence dir>/live-task-e2e node packages/omo-senpi/scripts/qa/task-e2e.mjs
- A minimal `task_output` library-surface driver that repeated terminal task status reads with notifications disabled and enabled, asserting that only the enabled case tells the caller to await a completion notification.

WHAT WAS OBSERVED
- TypeScript narrowing accepts the new no_progress TaskOutputDetails variant.
- Focused tests passed, including a regression proving rejected compaction preserves the status-read cache while accepted compaction clears it.
- Driver self-tests passed and the generated Senpi bundle was current.
- The scoped live driver passed every assertion: background spawn, completion wake, two unchanged same-session `task_output` status reads with the second returning `no_progress`, durable JSONL ordering, extension registration, zero leaked PIDs, and untouched real Senpi state. Its safe structured receipt is `live-task-e2e/verdict.json`.
- The direct terminal-notification driver reported that repeated reads instruct callers to await an opted-in task's future notification while it is pending or running; once terminal, only completed/error/lost tasks with an unacknowledged notification epoch remain awaitable. The TUI renders that factual reason rather than assuming a notification will arrive.
- After the first fix commit, GitHub CI passed typecheck, all platform tests, and Senpi compatibility on Ubuntu, macOS, and Windows. The follow-up rejected-compaction fix requires a fresh CI run after push.

WHY IT IS ENOUGH
- The original compile failure is covered by typecheck and a focused RPC codec regression.
- Polling suppression is covered by the six-case engine suite.
- Rejected-versus-accepted compaction cache behavior is covered directly at the adapter event bridge.
- The live harness actually drives the generated extension in a fresh sandbox, resumes the parent session explicitly for two output reads, proves the second unchanged status returns `no_progress`, and proves that the real Senpi agent directory was untouched. This scope deliberately tests the polling guard, not the separate task-revival suite. Repository CI remains the authoritative cross-platform compatibility gate.

WHAT WAS OMITTED
- Raw model/session transcripts, environment dumps, host paths, sandbox identifiers, task IDs, and PIDs were omitted.
- The receipt contains only booleans, counts, fixed check names, and sanitized event kinds; no raw logs are written.

PR #7662 REVIEW FOLLOW-UP
- `review-followup.md` records the fresh failing-first regression receipt, the bounded `no_progress` fix, the accepted-only compaction cache gate, focused test results, and generated-bundle integrity checks.
