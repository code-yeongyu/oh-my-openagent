# QA Evidence: Fix #3981 - run-mode poller hangs on interrupted/running session statuses

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/cli/run/poll-for-completion.test.ts --timeout 15000`
- Command: `bun test packages/omo-opencode/src/cli/run/ --timeout 20000` (full run-module suite)
- Command: `bun test packages/omo-opencode/src/features/background-agent/session-status-classifier.test.ts packages/omo-opencode/src/cli/run/completion.test.ts packages/omo-opencode/src/cli/run/events.test.ts packages/omo-opencode/src/cli/run/stdin-suppression.test.ts --timeout 20000`
- Command: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` (authoritative typecheck; LSP daemon unreachable in worktrees)
- Surface driven: `pollForCompletion()` in `packages/omo-opencode/src/cli/run/poll-for-completion.ts`, the completion loop of `oh-my-openagent run`, through a mocked OpenCode SDK client on Linux. The #3981 Windows/WSL scenario (session worker dies mid-read; server keeps reporting a status outside the old idle/busy/retry model) is simulated entirely through platform-independent client mocks per the task constraint that tests must run on Linux.

## WHAT WAS OBSERVED

Failing first (before the impl change):

- `returns 1 when the session stays interrupted after worker termination instead of hanging forever` FAILED: got 130 (looped until the test abort net) - reproduces the infinite "always loading" hang.
- `treats running status as active work and does not complete while it persists` FAILED: exited 0 while the server still reported `running`.

After the fix:

- poll-for-completion.test.ts: 23 pass / 0 fail (20 pre-existing + 3 new).
- Full `src/cli/run/` suite: 199 pass / 0 fail across 28 files.
- Classifier/completion/events/stdin-suppression neighbors: 43 pass / 0 fail.
- tsgo --noEmit on packages/omo-opencode: clean (exit 0).

Behavior contract pinned by the new tests:

1. Main-session status `interrupted` (worker terminated): never reported as success; exits 1 with "Session was interrupted before completion (worker terminated)." after 3 consecutive observations (INTERRUPTED_GRACE_CYCLES, mirroring ERROR_GRACE_CYCLES). A recovery to busy/retry/idle resets the counter, so runtime-fallback rearm is not killed (covered by "completes normally when an interruption recovers to busy then idle", which passed before and after - it guards against false exit-1).
2. Main-session status `running`: classified active (same as busy/retry); blocks completion for as long as it persists.
3. Unknown/unavailable statuses keep the previous conservative behavior (no state flip); missing status-map entry still means idle (pre-existing test).

Root cause: `getMainSessionStatus()` only recognized idle/busy/retry and returned null otherwise; the loop left `mainSessionIdle` at its initial false, so a dead (`interrupted`) session polled forever - the exact #3981 "always loading, can't complete" report. The vocabulary now matches `features/background-agent/session-status-classifier.ts` (active: busy/retry/running; settled: idle/interrupted).

## WHY IT IS ENOUGH

- The regression tests drive the real production poll loop with deterministic virtual-clock timing and assert both the hang-fix (exit 1 instead of infinite polling) and the no-regression paths (recovery completes 0; running blocks completion; all 20 pre-existing behaviors unchanged).
- The full run-module suite plus the status-classifier neighbor suites prove no blast radius outside the widened status model.
- Residual risk: real-harness WSL reproduction was not possible in this environment (Linux container, no Windows/WSL); the mocked tests simulate the server-side status sequence reported in the issue ("Worker has been terminated"). TUI-side Esc handling lives in OpenCode core, not this plugin, and is out of scope for this fix.

## WHAT WAS OMITTED

No secrets, tokens, auth headers, or env dumps are present in this evidence. Test output above is summarized to pass/fail counts and assertion deltas; full raw logs were transient shell output.
