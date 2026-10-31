# #3286 - Sisyphus waiting after task(): pruned queued task never rejects its concurrency waiter

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/features/background-agent/manager.test.ts -t "stuck concurrency waiter recovery"`
- New co-located regression test: `rejects the acquire waiter of a pruned pending task so processKey is not blocked forever`
- Surface: `BackgroundManager.pruneStaleTasksAndNotifications` onTaskPruned path x `ConcurrencyManager` waiter queue x `processKey` acquire wait.
- Behavior proven: when a pending task is stale-pruned ("Task timed out while queued") AFTER `processKey` already shifted it out of `queuesByKey` and parked on `concurrencyManager.acquire()`, the parked acquire must be rejected so the per-key processing loop settles instead of blocking that key forever.

## WHAT WAS OBSERVED

- RED (pre-fix): test failed at `expect(timedOut).toBe(false)` - received true. `processKeyForTest` promise never settled within 500ms because `onTaskPruned` removed the task from `queuesByKey` and marked it error without calling `concurrencyManager.cancelWaiter(rawKey, taskId)` (asymmetric with `cancelTask`, which does call it). `processingKeys` stayed occupied; every later launch on the same key early-returned and queued until TTL death - the reported cascade.
- GREEN (post-fix): same test passes in ~26ms. Fix adds `this.concurrencyManager.cancelWaiter(rawKey, taskId)` in the wasPending branch of onTaskPruned; the rejection is caught by processKey's existing cancelled/error/interrupt handler which rolls back the pre-start reservation and continues draining.
- Scoped suite: `bun test packages/omo-opencode/src/features/background-agent/` -> 744 pass, 0 fail, 1899 expect() calls across 59 files.
- Scoped typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0.

## WHY IT IS ENOUGH

The regression test reproduces the exact deadlock seam (prune-after-shift parking) deterministically without timers or real sessions; the scoped suite covers all adjacent lifecycle paths (cancelTask, resume, poller pruning, circuit breaker) and stays green, so the one-line asymmetry fix does not regress sibling release/cancel flows. Remaining risk: production Windows-specific stall triggers upstream of pruning are out of scope; this fix guarantees the queue processor recovers once tasks are TTL-pruned regardless of why they stalled.

## WHAT WAS OMITTED

No secrets, tokens, env dumps, or auth headers involved. Full-suite `bun test` root run and live OpenCode QA were not executed within the hard 15-minute ship timebox; the touched surface is covered by the scoped feature suite above. No real `~/.local/share/opencode` or `~/.codex` state was read or written (unit-only run).
