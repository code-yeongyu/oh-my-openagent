WHAT WAS TESTED

- Compared PR #6224 and its three feature commits against the local `dev` branch and searched dev history for the pause API and `final_wave_approval` behavior.
- Added and ran the focused restart regression in `packages/omo-opencode/src/hooks/atlas/event-handler-persisted-pause.test.ts` before and after the implementation change.
- Ran the Atlas final-wave, persisted-pause, and multi-work pause regressions together.
- Ran package typechecks for `packages/boulder-state` and `packages/omo-opencode`, LSP diagnostics for both changed TypeScript files, the TypeScript no-excuse audit, and a direct bundle of the OpenCode plugin entry.
- Drove the production Atlas event handler from a standalone Bun invocation with a persisted pause and an empty session map, matching plugin state immediately after restart.
- Drove real OpenCode in a disposable Docker container through `.agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`.

WHAT WAS OBSERVED

- `dev` does not contain commits `d9144eb2`, `f701fab6`, or `f1568957`, and does not contain an equivalent persisted final-wave pause implementation. PR #6224 remains necessary.
- RED: before the fix, the restart regression failed because the persisted `final_wave_approval` pause remained after the first user `message.updated` event.
- GREEN: after moving only the persisted clear outside the in-memory state guard, 10 focused tests passed with 0 failures and 38 assertions.
- Both affected package typechecks exited 0. LSP reported no diagnostics. The no-excuse audit reported no violations.
- The OpenCode plugin entry bundled 1,940 modules into a non-empty 5.64 MB artifact, then the temporary build directory was removed.
- The standalone driver reported `{"persistedPauseBeforeUserMessage":true,"persistedPauseAfterUserMessage":false,"inMemorySessionsAfterRestart":0,"tempDirectoryRemoved":true}`.
- The Docker SSE probe reported `first matching event: {"type":"server.connected"}` and `PASS: SSE /event opened and delivered server.connected`.
- Docker reported no remaining `omo-qa` containers after QA, and the standalone driver removed its temporary directory in `finally`.

RED TO GREEN

- Before implementation, `bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate-regression.test.ts` failed with `expect(received).toBeUndefined()` and received a `final_wave_approval` pause for `opencode:atlas-restarted-final-wave-session`: 4 passed, 1 failed.
- After implementation, `bun test packages/omo-opencode/src/hooks/atlas/event-handler-persisted-pause.test.ts packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate-regression.test.ts packages/boulder-state/src/write-state-pause.test.ts` reported 10 passed, 0 failed, 38 assertions.

VALIDATION OUTPUT

- `bunx tsgo --noEmit -p packages/boulder-state/tsconfig.json`: exit 0.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: exit 0.
- LSP diagnostics on `event-handler.ts` and `event-handler-persisted-pause.test.ts`: no diagnostics.
- Restricted-pattern audit across both changed TypeScript files found no `any` assertions, unknown assertions, suppression directives, non-null assertions, or enums.
- Affected OpenCode bundle: `Bundled 1940 modules in 60ms`, `index.js 5.64 MB`; the temporary bundle directory was removed after the non-empty artifact assertion.
- Oracle's reviewer gate found no issues and approved the delta unconditionally.

WHY IT IS ENOUGH

- The regression distinguishes the exact Codex review failure: a persisted pause must clear even when no Atlas `SessionState` exists after restart.
- The standalone driver executes the production pause storage and Atlas event handler together rather than duplicating their logic.
- The Docker SSE probe proves the real OpenCode event surface used by the Atlas hook is live and isolated from the host configuration and database.
- Existing final-wave and multi-work tests remain green, covering the adjacent invariants raised by the earlier human reviews.

WHAT WAS OMITTED

- Host OpenCode QA self-check was not used because the host lacks `sqlite3`; Docker supplied all required dependencies and isolation.
- A full repository build was attempted, but unrelated generated Codex/Senpi build work exceeded the command timeout. The affected OpenCode entry bundle and both affected package typechecks passed, and generated files from the timed-out build were restored before commit.
- No provider-backed model call was needed. This change handles an OpenCode lifecycle event and persisted local state, so the deterministic event driver plus real SSE delivery is the matching surface.
