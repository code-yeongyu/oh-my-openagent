# Memory delegation lifecycle evidence

Branch: `fix/mem-delegation-lifecycle`

## Initial RED

- Fix 1: unbounded `reserveSubagentSpawn` accepted unlimited descendants.
- Fix 2: sync delegation bypassed `ConcurrencyManager`.
- Fix 3: sync polling fetched the entire transcript every tick.
- Fix 4: delegated sessions were aborted but not deleted and lifecycle sets did not fully drain.

## Regression RED and GREEN

### B1 - continuation message-ID anchor

- RED: a newest-100 transcript page with a full-transcript count anchor (>=100) never passed the count gate.
- GREEN: continuation records `anchorMessageID` and the poller accepts bounded pages containing messages after that ID.

### B2 - nested sync concurrency reentrancy

- RED: nested sync delegation under `defaultConcurrency: 1` waited on the parent-held slot.
- GREEN: only root-level sync delegations acquire the gate; nested calls rely on the root slot and descendant guard.

### B3 - revival-safe deletion timers

- RED: an untracked completion timer could delete a revived live continuation at the original deadline.
- GREEN: deletion timers are tracked by session ID; continuation start cancels the timer and completion schedules a fresh grace period.

### R1 - abort/recovery ID anchor

- RED: abort recovery compared `finalMessages.length` to the full transcript count anchor; a newest-100 page could report a completed continuation as `Task aborted` when the anchor was >=100.
- GREEN: abort recovery now calls the same `hasMessagesAfterAnchor` ID-based comparison as normal polling, with count fallback only when no ID anchor exists.

### R2 - failed continuation timer restoration

- RED: continuation revival cancelled the pending deletion timer, while prompt-dispatch failure returned before the handed-back-only `finally` branch re-armed it.
- GREEN: every terminal continuation path schedules deletion; failed continuation sessions regain the cleanup grace timer.

## Remote GREEN

Required command:

```text
MAC_TEST_TIMEOUT_S=2700 bun /tmp/omo-mac-test2.mjs fix/mem-delegation-lifecycle -- packages/omo-opencode/src/features/background-agent packages/omo-opencode/src/tools/delegate-task
```

Previous full run:

```text
1230 pass
0 fail
3022 expect() calls
Ran 1230 tests across 101 files
```

Final R1/R2 run: pending.

## Final design notes

- `background_task.maxLiveDescendantsPerRoot` defaults to `24`, intentionally above the `ConcurrencyManager` scheduler so legitimate tasks queue rather than fail. `0` disables the guard.
- Sync session deletion follows `TASK_CLEANUP_DELAY_MS` to preserve full-session read-back and continuation grace windows.
- Parent wake inspection has no cross-check transcript cache; each distinct wake check observes fresh history. New sync polling uses bounded `limit: 100` reads.
- Existing tests were left unmodified.
