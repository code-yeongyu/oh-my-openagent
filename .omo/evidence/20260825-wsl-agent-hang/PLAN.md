# Plan: Fix #3981 - run-mode poller hangs forever on non-idle/busy/retry session statuses

## Root cause

`packages/omo-opencode/src/cli/run/poll-for-completion.ts` `getMainSessionStatus()`
only recognizes `idle | busy | retry`. Any other status type reported by the
OpenCode server (`running`, `interrupted`) makes it return `null`, and the poll
loop leaves `eventState.mainSessionIdle` at its previous value (initially
`false`). When a session worker dies mid-run (the #3981 WSL "Worker has been
terminated" / always-loading symptom), the server reports the session as
`interrupted` indefinitely, so `omo run` polls forever and never completes.

The authoritative status vocabulary already exists in
`features/background-agent/session-status-classifier.ts`:
active = `busy | retry | running`, terminal = `idle | interrupted`.
The run-mode poller was never widened to match.

## Change (minimal, one impl file)

`poll-for-completion.ts`:

1. Widen the local status model to `idle | busy | retry | running | interrupted`.
2. Classify `running` as active (same as busy/retry): sets `mainSessionIdle = false`
   and must block completion while present.
3. Classify `interrupted` as not-running (`mainSessionIdle = true`) but track
   consecutive interrupted observations (`INTERRUPTED_GRACE_CYCLES = 3`,
   mirroring `ERROR_GRACE_CYCLES`). If the session stays interrupted across the
   grace window, print a clear message and return exit code 1 instead of
   looping forever. A live recovery (runtime fallback rearms the session to
   busy/retry) resets the counter, so only genuinely dead sessions terminate.
4. Unknown/unavailable statuses keep today's conservative behavior (no state flip).

No changes to `types.ts` (the poller already reads `.type` through a local
string-typed map), no changes to completion.ts, no behavioral change for
idle/busy/retry flows.

## Tests (co-located, failing-first, platform-mocked)

In `poll-for-completion.test.ts` (virtual clock, mocked SDK client - runs on
Linux, simulates the WSL worker-termination scenario through mocks):

1. `returns 1 when the session stays interrupted (worker terminated) instead of hanging forever`
   - statuses pinned to `{ type: "interrupted" }`, no todos/children.
   - Before fix: loop never exits (would hang / only abort via test timeout).
   - After fix: returns 1 after the grace cycles with an interruption message.
2. `completes normally when a brief interruption recovers to busy then idle`
   - interrupted x2 -> busy -> idle: returns 0, proves the grace counter resets
     on recovery and fallback-rearm is not killed.
3. `treats running status as active work and blocks completion`
   - statuses pinned to `{ type: "running" }`: does not exit 0 while running;
     flips to idle -> exits 0.

## Verification

- `bun test packages/omo-opencode/src/cli/run/poll-for-completion.test.ts` (red first, then green)
- Neighbors: `completion*.test.ts events.test.ts event-handlers.test.ts stdin-suppression.test.ts`
- Scoped typecheck: `tsgo --noEmit` for packages/omo-opencode (LSP daemon may be unreachable in worktrees; tsgo is authoritative).
- Evidence + QA notes in this directory.
