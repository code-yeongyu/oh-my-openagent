# Background Task Retry Timeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured retry-attempt history to background tasks and surface a compact attempt timeline in parent chat while preserving separate retry child sessions.

**Architecture:** Extend `BackgroundTask` with explicit `attempts[]` state and `currentAttemptID`, add small helper functions to keep task-level fields as a projection of the current attempt, and wire those helpers into background retry, session creation, and completion/error paths. Parent notifications remain the UI surface, but they are generated from structured attempt state instead of ad hoc retry text.

**Tech Stack:** TypeScript, Bun test, OpenCode background task engine, parent chat notification flow

---

## File Structure

### Files to modify

- `src/features/background-agent/types.ts`
  - Extend `BackgroundTask` with `attempts[]` and `currentAttemptID`
  - Add attempt type definition and any retry-observability support fields needed

- `src/features/background-agent/manager.ts`
  - Add/consume helper functions for attempt lifecycle
  - Bind retry child session ids to exact attempts in `startTask()`
  - Resolve lifecycle events through `sessionID -> attemptID`
  - Generate final parent summary from `attempts[]`

- `src/features/background-agent/fallback-retry-handler.ts`
  - Create next attempt entry during retry scheduling
  - Finalize failed attempt before queueing retry
  - Preserve retry notification metadata without mutating historical attempts

- `src/features/background-agent/background-task-notification-template.ts`
  - Add compact attempt timeline rendering for parent-facing notifications

- `src/tools/background-task/task-result-format.ts`
  - Optional first-pass alignment if task results need to reference attempt-derived terminal state consistently

### Files to test

- `src/features/background-agent/manager.test.ts`
- `src/features/background-agent/fallback-retry-handler.test.ts`
- `src/tools/background-task/task-result-format.test.ts`

### Files to inspect for patterns/reference only

- `src/features/background-agent/session-idle-event-handler.ts`
- `src/features/background-agent/task-history.ts`
- `src/features/background-agent/session-status-classifier.ts`
- `docs/superpowers/specs/2026-04-27-background-task-retry-timeline-design.md`

---

### Task 1: Define structured attempt state

**Files:**
- Modify: `src/features/background-agent/types.ts`
- Test: `src/features/background-agent/manager.test.ts`

- [ ] **Step 1: Add a focused failing test that expects attempt state on a new background task**

Add a test in `src/features/background-agent/manager.test.ts` that launches a background task and expects:
- `attempts` to exist
- first attempt to have `attemptNumber: 1`
- `currentAttemptID` to point at that first attempt
- top-level task fields to still exist for compatibility

- [ ] **Step 2: Run the new test to verify it fails for the expected reason**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: the new assertion fails because `attempts[]` and `currentAttemptID` do not exist yet.

- [ ] **Step 3: Add the attempt state types to `BackgroundTask`**

Update `src/features/background-agent/types.ts` to add:
- `BackgroundTaskAttempt` type/interface with:
  - `attemptID`
  - `attemptNumber`
  - `sessionID?`
  - `providerID?`
  - `modelID?`
  - `variant?`
  - `status`
  - `error?`
  - `startedAt?`
  - `completedAt?`
- `attempts?: BackgroundTaskAttempt[]`
- `currentAttemptID?: string`

- [ ] **Step 4: Initialize first attempt state when tasks are created**

In `src/features/background-agent/manager.ts`, when `launch()` creates the initial `BackgroundTask`, initialize:
- one attempt entry in `pending`
- `currentAttemptID` referencing that entry
- top-level `model` copied into attempt model fields

- [ ] **Step 5: Re-run the test to verify the new task has attempt state**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: the new launch/creation test passes.

---

### Task 2: Add attempt lifecycle helper functions

**Files:**
- Modify: `src/features/background-agent/manager.ts`
- Test: `src/features/background-agent/manager.test.ts`

- [ ] **Step 1: Add a failing test for exact attempt binding in `startTask()`**

Add a test that simulates:
- a task with a pending retry attempt
- `startTask()` creating a child session
- the session being bound to the exact scheduled attempt, not merely "the latest pending attempt"

The test should assert:
- `sessionID` lands on the correct attempt
- `currentAttemptID` remains correct
- top-level task `sessionID` mirrors that active attempt

- [ ] **Step 2: Run the test to verify it fails before helpers exist**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: binding assertions fail or require manual task mutation not yet implemented.

- [ ] **Step 3: Implement helper functions inside `manager.ts`**

Add small focused helpers, either in `manager.ts` or a dedicated sibling helper file if needed:
- `startAttempt(task, initialModel)`
- `bindAttemptSession(task, attemptID, sessionID, model)`
- `scheduleRetryAttempt(task, failedAttemptID, nextModel, error)`
- `finalizeAttempt(task, attemptID, terminalStatus, error?)`

These helpers must enforce:
- only `currentAttemptID` is mutable
- finalized attempts are immutable
- binding by explicit `attemptID`

- [ ] **Step 4: Add a `sessionID -> attemptID` mapping strategy**

Implement one of:
- a map stored on the task
- or a lookup derived from attempts by session id

The first implementation can be simple, but every lifecycle event must resolve the attempt through this mapping before mutating state.

- [ ] **Step 5: Define an explicit queued work contract that carries `attemptID` into `startTask()`**

Update the implementation plan so queued background work carries the scheduled `attemptID` explicitly.

Concretely:
- extend the queue item / queued work shape to include `attemptID`
- ensure retry scheduling writes that `attemptID` at queue time
- ensure `startTask()` receives the exact `attemptID` and never infers “latest pending attempt”

This is required to satisfy the approved spec’s exact-binding rule.

- [ ] **Step 6: Re-run the manager tests**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: new binding and helper tests pass.

---

### Task 3: Record retries as new attempts instead of overwriting task state

**Files:**
- Modify: `src/features/background-agent/fallback-retry-handler.ts`
- Test: `src/features/background-agent/fallback-retry-handler.test.ts`

- [ ] **Step 1: Add a failing test for retry scheduling creating Attempt 2**

Add a test that starts with a task already representing Attempt 1 and then runs `tryFallbackRetry()`.

Expected behavior:
- Attempt 1 becomes terminal `error`
- Attempt 2 is created as `pending`
- `currentAttemptID` moves to Attempt 2
- top-level `task.model` mirrors Attempt 2 model

- [ ] **Step 2: Run the retry-handler test to verify it fails**

Run:
```bash
bun test src/features/background-agent/fallback-retry-handler.test.ts
```

Expected: no structured attempt chain exists yet, so assertions fail.

- [ ] **Step 3: Update retry scheduling to use attempt helpers**

In `src/features/background-agent/fallback-retry-handler.ts`:
- finalize the current attempt before retry queueing
- create the next pending attempt
- preserve retry notification metadata on the task
- keep top-level compatibility fields aligned with the new active attempt

- [ ] **Step 4: Re-run the retry-handler tests**

Run:
```bash
bun test src/features/background-agent/fallback-retry-handler.test.ts
```

Expected: retry now produces a correct attempt chain.

---

### Task 4: Route all session lifecycle mutations through attempt identity

**Files:**
- Modify: `src/features/background-agent/manager.ts`
- Reference: `src/features/background-agent/session-idle-event-handler.ts`
- Test: `src/features/background-agent/manager.test.ts`

- [ ] **Step 1: Add a failing stale-event regression test**

Create a test that simulates:
- Attempt 1 fails and Attempt 2 becomes current
- a late event from Attempt 1’s old `sessionID` arrives

Expected:
- Attempt 2 and top-level task projection do not change
- stale event is ignored for state mutation

- [ ] **Step 2: Run the test to verify the stale-event case fails first**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: stale-event mutation is not yet blocked.

- [ ] **Step 3: Update lifecycle handlers to resolve `sessionID -> attemptID` first**

Apply this rule in relevant background manager paths:
- `message.updated`
- `session.error`
- `session.status`
- completion/idle handling if they mutate attempt/task state

Before mutating state:
1. resolve the `attemptID` from the incoming `sessionID`
2. verify it still matches `currentAttemptID`
3. otherwise ignore/log as stale

- [ ] **Step 4: Re-run the manager tests**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: stale-event regression passes.

---

### Task 5: Render the attempt timeline in parent chat summaries

**Files:**
- Modify: `src/features/background-agent/background-task-notification-template.ts`
- Test: `src/features/background-agent/manager.test.ts`

- [ ] **Step 1: Add a failing notification-format test for multi-attempt tasks**

Create a test that builds a completed/failed task with three attempts and expects parent-facing summary text containing:
- attempt number
- status
- model
- session id

- [ ] **Step 2: Run the test to verify it fails first**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: current notifications do not include a structured attempt timeline.

- [ ] **Step 3: Update notification template to render compact attempt timeline**

In `background-task-notification-template.ts`:
- keep the summary compact
- render one line per attempt
- include error text only for failed attempts where useful
- do not replace separate retry reminders; final summary is additive

- [ ] **Step 4: Update manager-side aggregation so final summaries carry attempt history**

`notifyParentSession()` currently batches through `completedTaskSummaries` in `manager.ts`, which only stores task-level summary data.

Modify that aggregation path so the final per-task notification has access to the task’s structured `attempts[]` data at summary time.

Allowed implementation directions:
- extend `BackgroundTaskNotificationTask` to include attempt timeline data
- or bypass the reduced aggregation shape for final parent summaries and pass the original task objects (or a richer projection)

The key requirement is that the final parent summary must render the authoritative attempt timeline from structured state, not from task-level status alone.

- [ ] **Step 5: Re-run notification tests**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: parent-summary timeline is now shown from `attempts[]` state.

---

### Task 6: Preserve retry observability messages from state

**Files:**
- Modify: `src/features/background-agent/manager.ts`
- Test: `src/features/background-agent/manager.test.ts`

- [ ] **Step 1: Add a failing test that retry-scheduled and retry-session-ready notifications are derived from attempt state**

The test should verify:
- retry scheduled reminder still includes failed session id, failed model, error, next model
- retry session ready reminder includes new retry session id and attempt number

- [ ] **Step 2: Run the test to verify current behavior is incomplete**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: notifications are not yet driven by structured attempt state.

- [ ] **Step 3: Refactor retry notifications to read from attempts**

Make the existing retry observability path use `attempts[]` + `currentAttemptID` instead of ad hoc fields where practical.

- [ ] **Step 4: Re-run manager tests**

Run:
```bash
bun test src/features/background-agent/manager.test.ts
```

Expected: retry observability remains correct after the attempt-state refactor.

---

### Task 7: End-to-end regression sweep for background retry history

**Files:**
- Test: `src/features/background-agent/manager.test.ts`
- Test: `src/features/background-agent/fallback-retry-handler.test.ts`
- Test: `src/tools/background-task/task-result-format.test.ts`

- [ ] **Step 1: Add an end-to-end regression covering multiple retries followed by success**

Test expectations:
- 3 attempts recorded
- first two failed with distinct models/session ids
- third completed successfully
- parent summary contains all three attempts in order

- [ ] **Step 2: Run the focused regression suite**

Run:
```bash
bun test src/features/background-agent/manager.test.ts src/features/background-agent/fallback-retry-handler.test.ts src/tools/background-task/task-result-format.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the broader fallback regression suite**

Run:
```bash
bun test src/features/background-agent/manager.test.ts src/features/background-agent/fallback-retry-handler.test.ts src/features/background-agent/error-classifier.test.ts src/tools/background-task/task-result-format.test.ts src/tools/delegate-task/sync-session-poller.test.ts src/tools/delegate-task/sync-task.test.ts src/plugin/event.test.ts src/shared/model-error-classifier.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run typecheck and build**

Run:
```bash
bun run typecheck
bun run build
```

Expected: both commands succeed with no errors.

---

### Task 8: Final verification and handoff

**Files:**
- Review: all modified files above

- [ ] **Step 1: Manually verify task-level projection consistency**

Check in code review that:
- active attempt and top-level fields always agree
- finalized attempts are not mutated later
- stale events are ignored

- [ ] **Step 2: Confirm parent chat UX remains compact**

Check that final attempt timeline is readable and not overly verbose.

- [ ] **Step 3: Prepare implementation summary**

Document:
- files changed
- new attempt-state invariants
- tests added/updated

- [ ] **Step 4: Commit**

```bash
git add src/features/background-agent/types.ts src/features/background-agent/manager.ts src/features/background-agent/fallback-retry-handler.ts src/features/background-agent/background-task-notification-template.ts src/features/background-agent/manager.test.ts src/features/background-agent/fallback-retry-handler.test.ts src/tools/background-task/task-result-format.test.ts docs/superpowers/specs/2026-04-27-background-task-retry-timeline-design.md docs/superpowers/plans/2026-04-27-background-task-retry-timeline.md
git commit -m "feat(background-task): add retry attempt timeline"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-27-background-task-retry-timeline.md`. Ready to execute?
