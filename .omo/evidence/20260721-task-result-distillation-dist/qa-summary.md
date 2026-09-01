# QA summary — distill background task results

- Focused formatter suite passed (3/3): session errors retain priority, only the final assistant answer is returned, cursor semantics are retained, and tool-result fallback excludes reasoning blocks.
- Workspace typecheck passed, including `packages/omo-opencode`.
- Real OpenCode plugin-load smoke loaded the built local plugin (`plugin_loaded: true`) in isolated XDG directories. The real database count stayed 2979 before and after.
- The full wake-split probe was attempted with a 180-second outer timeout, but its health-check helper has no per-request curl timeout and stalled before session creation on this run. No real database mutation occurred. This limitation is recorded rather than presented as a passing end-to-end result.

Artifacts: `targeted-tests.txt`, `typecheck.txt`, `plugin-load-smoke.txt`, `isolation-receipt.txt`, `fake-llm.log`.

