# Plan — issue #6532: task_send revival never wakes the parent

## Root cause (file:line)

1. `packages/senpi-task/src/steering/engine.ts:92-109` — `reviveTerminal()` re-arms a terminal
   resident child (`handle.followUp()` + `buildRevived()`) but NEVER promotes the revived epoch
   to background.
2. `packages/senpi-task/src/steering/engine.ts:301-312` — `buildRevived()` passes
   `notify_on_terminal` / `background_mode` through untouched; only `run_epoch` increments.
3. `packages/senpi-task/src/manager/manager.ts:525-529` — `wasBackground()` reads
   `record.notify_on_terminal`, still `false` for an originally-sync task after revival.
4. `packages/omo-senpi/src/components/task/completion-bridge.ts:47` forwards
   `wasBackground(taskId)` into the notifier request.
5. `packages/senpi-task/src/completion/notifier.ts:114` — `notifyTerminal()` returns
   `{ kind: "skipped", reason: "sync-task" }` before idle wake routing is reached. The parent
   never learns the revived subagent finished.

## Fix (direction endorsed in the issue by reporter + maintainer)

Promote the revived epoch to background BEFORE `followUp()` begins; roll back if starting the
follow-up fails.

| File | Change |
|------|--------|
| `packages/senpi-task/src/steering/types.ts` | Add `promoteToBackground(taskId): boolean` to `SteeringPort`. |
| `packages/senpi-task/src/manager/manager.ts` | Wire the new port member to the existing public `promoteToBackground()` (~line 180). |
| `packages/senpi-task/src/steering/engine.ts` | In `reviveTerminal()`: capture pre-revive `record.notify_on_terminal`; if false, promote via port before `followUp`; on followUp rejection roll back via `store.mutate` (restore `notify_on_terminal: false` + prior `background_mode`, guarded so a concurrent promotion is never clobbered). |
| `packages/senpi-task/src/steering/__fixtures__/steering-fakes.ts` | Harness port gains a faithful store-backed `promoteToBackground` (+ call tracking). |
| `packages/senpi-task/src/steering/engine.test.ts` | Two inline ports (pending-cancellation + restart harness) gain no-op `promoteToBackground`. |

## Failing-first tests

A. `engine.test.ts` (co-located, both runner flavors where applicable):
   1. completed resident sync child → revive promotes BEFORE follow-up starts (handle snapshots
      record state at followUp time) and record ends `notify_on_terminal: true`,
      `background_mode: "promoted"`.
   2. follow-up fails to start → promotion rolled back (`notify_on_terminal: false`,
      `background_mode: "foreground"`), error propagates, revive reservation released.
   3. originally-background child → revival keeps `background_mode: "background"` (no mutation).
B. `completion-bridge.test.ts` (end-to-end regression, settle-able file-local runner):
   - sync spawn → terminal (0 messages: sync suppression intact) → `continueTask` revive →
     second completion → exactly ONE wake message for epoch 1;
   - repeated revivals → exactly one message per epoch;
   - originally-background spawn → one message per epoch across revival, no duplicates.

## Verification

- `bun test packages/senpi-task packages/omo-senpi` (scoped suites incl. chaos bench)
- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- Live driver attempt documented honestly (senpi binary availability permitting).

## Constraints honored

No type suppression, no weakened/deleted tests, no unrelated refactors, single conventional
commit staging only touched files + this evidence dir, push to fork branch, PR base `dev`.
