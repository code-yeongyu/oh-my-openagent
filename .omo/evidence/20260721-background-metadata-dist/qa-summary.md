# QA summary — canonical background metadata

- Focused delegate-task suites passed (29/29), including background launch, late session resolution, continuation, and both new `metadata.background === true` assertions.
- Workspace typecheck passed, including `packages/omo-opencode`.
- Real OpenCode plugin-load smoke loaded the built local plugin (`plugin_loaded: true`) in isolated XDG directories. The real database count stayed 2979 before and after.
- The repository wake-split probe exercised a real parent tool turn and completed one child task (`child_task_sessions=1`, `terminal_stops=1`). Its final wake-route assertion was inconclusive because current dev emitted neither a wake branch nor the legacy route-provenance log; the focused metadata assertions remain green.

Artifacts: `targeted-tests.txt`, `typecheck.txt`, `plugin-load-smoke.txt`, `marker-metrics.txt`, `isolation-receipt.txt`, `harness.log`, `fake-llm.log`.

