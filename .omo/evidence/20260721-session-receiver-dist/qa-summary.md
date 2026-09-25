# QA summary — preserve SDK session receiver

- Targeted regression: `session-activity.test.ts` passed (1/1). The fake SDK method reads receiver state, so the old detached call throws and the fixed receiver-bound call returns the activity timestamp.
- Workspace typecheck passed, including `packages/omo-opencode`.
- Real OpenCode plugin-load smoke loaded the built local plugin (`plugin_loaded: true`) in isolated XDG directories. The real database count stayed 2979 before and after.
- The repository wake-split probe reached a completed child task (`child_task_sessions=1`, `terminal_stops=1`) in an isolated database. Its final route assertion was inconclusive because current dev emitted neither a wake branch nor the legacy route-provenance log; this is outside the receiver-binding change.

Artifacts: `targeted-tests.txt`, `typecheck.txt`, `plugin-load-smoke.txt`, `marker-metrics.txt`, `isolation-receipt.txt`, `harness.log`, `fake-llm.log`.

