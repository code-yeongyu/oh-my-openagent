# Evidence: 20260825-2063-todo-continuation-loop

Issue: code-yeongyu/oh-my-openagent#2063 - todo-continuation fires during provider fallback, causing a retry loop.
Branch: issue/2063-todo-continuation-fallback-loop (base c7094b8ac)

## WHAT WAS TESTED

1. Failing-first regression proof (red run before the fix):
   `bun test packages/omo-opencode/src/hooks/shared/fallback-cycle-registry.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/fallback-cycle-suppression.regression.test.ts packages/omo-opencode/src/hooks/runtime-fallback/fallback-cycle-probe.regression.test.ts`
   Before implementation all 3 files failed with "Cannot find module '../shared/fallback-cycle-registry'" (0 pass / 3 fail) - the suppression behavior did not exist.
2. Scoped unit gate after the fix:
   `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/ packages/omo-opencode/src/hooks/runtime-fallback/ packages/omo-opencode/src/hooks/shared/`
   -> 499 pass / 0 fail across 58 files (captured in scoped-tests.txt).
3. Repo typecheck gate: `bun run typecheck` (tsgo --noEmit + typecheck:script + typecheck:packages over all workspace packages) -> clean exit, no errors.

## WHAT WAS OBSERVED

- Root cause: `packages/omo-opencode/src/hooks/todo-continuation-enforcer/idle-event.ts` (`handleSessionIdle`, guard chain at lines ~42-90) had no awareness of runtime-fallback retry state. During a fallback cycle (retry dispatch + awaiting fallback result, often longer than ABORT_WINDOW_MS = 3000ms), `session.idle` passed every guard, todos were incomplete, and a continuation was injected toward the failing model, repeating the loop. The runtime-fallback state (`sessionRetryInFlight` / `sessionAwaitingFallbackResult` Sets inside the `runtime-fallback/hook.ts` deps closure) was invisible to other hooks.
- Fix: new cross-hook signal `packages/omo-opencode/src/hooks/shared/fallback-cycle-registry.ts` (`FallbackCycleRegistry`: register/unregister/isActive). `runtime-fallback/hook.ts` registers a live probe `(sessionID) => deps.sessionRetryInFlight.has(sessionID) || deps.sessionAwaitingFallbackResult.has(sessionID)` at hook creation and unregisters it (identity-checked) in dispose. `todo-continuation-enforcer/idle-event.ts` skips injection when `FallbackCycleRegistry.isActive(sessionID)` (guard placed after the wasCancelled check). Because the probe reads the live Sets, every existing add/delete/cleanup path (dispatch, timeout, session.stop, session.deleted, stale cleanup, dispose) is honored with zero changes to runtime-fallback mutation logic.
- New tests (given/when/then):
  - `fallback-cycle-suppression.regression.test.ts`: idle with incomplete todos + active cycle -> trackContinuationProgress never called, countdown never started; idle after cycle cleared -> continuation proceeds (trackCalls length 1).
  - `fallback-cycle-probe.regression.test.ts`: real `createRuntimeFallbackHook` driven end-to-end: session.created + session.error(429) dispatches a fallback retry through the prompt gate (promptAsync called), registry reports active; session.idle mid-cycle stays active; session.stop clears -> inactive; disposed hook unregisters its probe.
  - `fallback-cycle-registry.test.ts`: register/query/unregister semantics incl. identity-checked unregister so a stale hook dispose cannot unhook a newer probe.

## WHY IT IS ENOUGH

- The failing-first red run proves the regression test exercises the missing behavior, and the same tests pass after the minimal fix.
- The probe reflects the exact source-of-truth Sets that runtime-fallback already uses to guard its own re-entry (event-handler.ts lines 141, 170, 218, 226), so suppression windows match runtime-fallback's own definition of "cycle in progress" precisely - no mirrored state that can drift or leak.
- The scoped suites cover both touched hook directories plus hooks/shared (499 tests), and the repo-wide tsgo typecheck covers cross-package types. Residual risk: a second concurrently-created runtime-fallback hook instance would replace the registered probe (last-writer-wins); production loads exactly one plugin instance per process, and identity-checked unregister prevents a stale dispose from unhooking the live probe.

## WHAT WAS OMITTED

- Full-repo `bun test` root suite and live OpenCode harness QA (opencode-qa skill): reproducing the loop requires a real provider returning rate-limit errors mid-session with boulder todos active; not feasible hermetically here. The unit tests drive the real hook event pipeline (createRuntimeFallbackHook -> event-handler -> auto-retry dispatcher -> prompt-async gate) with a mocked client, which pins the cross-hook contract. No secrets, tokens, env dumps, or auth headers are contained in this evidence.
