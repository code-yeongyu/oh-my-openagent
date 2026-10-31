# Evidence: issue #6751 - runtime_fallback position reset mid-cycle

Branch: fix/6751-runtime-fallback-position-reset (base origin/dev @ 8c57e463e)
Worktree: ../oom-wt-6751
Date: 2026-08-26

## WHAT WAS TESTED

1. TDD RED->GREEN unit coverage (bun test):
   - event-handler.test.ts: stop-echo preservation, stop+idle echo pair
     preservation, forward-only progression across echoes with the issue's
     chain shape (primary = chain[0]), genuine-user-stop full-reset guard.
   - chat-message-handler.test.ts: marker-carrying retry dispatch never
     triggers manual-change reset (identity + position fields pinned),
     pendingFallbackModel consumption happy path preserved.
   - runtime-fallback-position.test.ts (new): end-to-end through the real
     createRuntimeFallbackHook with fake client - dispatched models are
     exactly [go/fallback-a, zen/fallback-b], never revisiting failed models,
     plus legitimate fresh-cycle behavior after genuine user stop.
   - auto-retry.test.ts: first-prompt-watchdog abort source marks
     internallyAbortedSessions like every other fallback-following abort.
   RED proof: logs/red-new-tests.log shows 5 failures on unmodified code;
     logs/red-baseline.txt shows the directory green before new tests.
2. Gates over final tree, twice consecutively (logs/gates-run2.log,
   logs/tsgo-run2.log): 366 tests pass across runtime-fallback/ plus adjacent
   suites (fallback.cliproxyapi-matrix, prompt-async-route-audit,
   model-suggestion-retry, prompt-async-gate-client-identity,
   prompt-async-gate-path-compat, session-route, create-session-hooks);
   tsgo --noEmit exit 0 both rounds; git diff --check clean; hygiene scan
   (as any / ts-ignore / ts-expect-error / non-null assertions) zero hits.
3. Isolated QA (logs/qa-transcript.txt, runner /tmp/opencode/issue-6751/):
   real handlers driven through the reported stalled cycle. S1 forward-only
   hops with 2ms inter-hop gap (issue reported ~14 minutes of stall), no
   backward hop to primary; S2 genuine user stop still starts a fresh cycle;
   S3 genuine manual model change still resets (no stale-position
   continuation); S4 exhausted chain stays silent, primary never revisited.
   8/8 assertions pass.

## WHAT WAS OBSERVED

Before fix: abort echoes (session.stop / session.idle) wiped fallbackIndex,
failedModels and pendingFallbackModel mid-cycle (logs/red-new-tests.log
received-values show exactly the issue's wipe signature); the next failure
re-dispatched an already-failed model (go/fallback-a repeated).
After fix: echo events are recognized via internallyAbortedSessions and
ignored; marked retry dispatches can never be misread as manual model
changes; position advances monotonically and cooldowns survive.

## WHY IT IS ENOUGH

Both reported vectors have dedicated RED->GREEN tests at unit level plus an
end-to-end monotonicity pin through the real hook composition. The QA
simulation reproduces the exact event interleaving from the issue log and
measures wall-clock gap between hops. Regression guards pin that genuine
user stops, external aborts, and manual model changes keep their existing
reset semantics (existing tests for external abort and #4006 internal-abort
preservation remain green untouched).

## WHAT WAS OMITTED

No secrets, tokens, or auth headers are involved in this change surface;
logs contain only synthetic model ids (zai/primary, go/fallback-a,
zen/fallback-b) and fake client payloads. The live opencode SSE/TUI smoke
lane was not run because the change surface is plugin-internal state-machine
logic fully exercised through the real hook entry points in-process; no
client API contract changed (promptAsync/abort/messages payloads identical).

## FILES CHANGED

- packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts
  (internal-abort echo guards in handleSessionStop/handleSessionIdle)
- packages/omo-opencode/src/hooks/runtime-fallback/chat-message-handler.ts
  (runtime-fallback retry marker guard before manual-change detection)
- packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-abort.ts
  (first-prompt-watchdog joins the marked internal-abort sources)
- tests: event-handler.test.ts, chat-message-handler.test.ts,
  auto-retry.test.ts, runtime-fallback-position.test.ts (new)

Full patch: logs/final-diff.patch
