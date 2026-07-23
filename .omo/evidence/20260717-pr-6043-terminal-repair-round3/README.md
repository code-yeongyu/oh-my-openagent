# PR #6043 Terminal-Race Repair QA

Date: 2026-07-17

## Source Identity

- Starting PR head: `e943ccceecb31e6594a0a0a569452ceee83805d5`
- QA patch SHA-256: `ad33aa0f3b2ef61a324087177ad446357663b0cd61a4c9ed19ea4d2d097f382a`
- Changed source: `session-status-handler.ts` and `runtime-fallback-terminal-races.test.ts`
- The patch snapshots and detaches watchdog ownership before abort I/O, rolls it back on every non-dispatch exit, and commits it only after an accepted fallback dispatch.

The live harness receipt records the starting Git head because the repair was intentionally exercised before commit. The patch digest above binds the recorded runs to the exact reviewed source diff. Integrated-head QA is recorded separately after merging the latest `origin/dev`.

## What Was Tested

### Failing-First Regression

The new terminal-race test drives this ordering:

1. A status retry begins and starts aborting the silent request.
2. The abort terminal arrives before the abort HTTP response.
3. The replacement fallback dispatch is rejected.
4. The watchdog must regain ownership and retry successfully.

Before the production repair, the observable counts were `{ aborts: 1, dispatches: 1 }`; the test expected `{ aborts: 2, dispatches: 2 }`. After the repair, all five terminal-race cases pass. The final run is included in `runtime-fallback-suite.txt`.

### Automated Regression Coverage

- `runtime-fallback-suite.txt`: 341 pass, 0 fail, 687 expectations across 50 runtime-fallback files.
- `shared-boundaries.txt`: 84 pass, 0 fail, 157 expectations across lifecycle, prompt-gate, and model-fallback boundaries.
- `typechecks-static.txt`: OpenCode and utils typechecks, Biome, no-excuse audit, `git diff --check`, and pure-LOC checks passed. The changed production and test files are 172 and 173 pure LOC respectively.

### Mandatory OpenCode Harness QA

- `server-smoke.txt`: isolated authenticated server health, OpenAPI surface, and unauthenticated rejection passed.
- `sse-self-test.txt`: isolated SSE stream delivered `server.connected`.
- `tui-smoke.txt`: isolated tmux TUI rendered and accepted input; the real DB remained at 5,751 sessions.
- `live-harness-terminal.txt` and `live-isolation-receipt.txt`: a production-duration isolated live plugin run proved an older root still falls back while two roots are active, deleting the newer root restores the older root, fallback-owned success does not re-arm the watchdog, and a later user abort remains external.

## Isolation And Sanitization

- Every OpenCode process used isolated XDG data, config, state, and cache directories.
- The live sandbox created one session; the real OpenCode DB count was unchanged.
- Provider output, plugin decisions, SSE events, and root-state transitions are retained only in sanitized artifacts.
- Raw server streams, raw plugin logs, authorization material, generated passwords, and temporary sandbox directories were omitted.

## Why This Is Enough

The failing-first test covers the exact ownership loss found by the independent reviewer. The full runtime-fallback suite protects adjacent abort, retry, timeout, progress, and delayed-terminal behavior. The isolated live run exercises the user-visible main-session watchdog through real OpenCode server and event surfaces, including the active-root lifecycle behavior most likely to regress.

## Remaining Risk

The repair changes only ownership timing around one status-retry transaction. It does not alter fallback selection, retry limits, prompt-gate policy, timeout policy, or public configuration. Cross-platform CI and fresh exact-head review remain required after the repaired head is pushed.
