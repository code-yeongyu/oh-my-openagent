# Background Task Retry Timeline Design

Date: 2026-04-27
Status: Draft approved for spec review

## Goal

Make background task retries understandable from the parent chat UI.

Today, retry attempts create separate child sessions, but the user mainly sees the first failed child session and has to infer whether a retry happened. The goal is to preserve separate retry child sessions while presenting an attempt timeline in the parent chat.

## User Outcome

For a background task that retries across models, the parent chat should show a compact attempt timeline such as:

- Attempt 1 — failed — `openai/gpt-5.4-mini` — session `ses_aaa`
- Attempt 2 — failed — `anthropic/claude-haiku-4.5` — session `ses_bbb`
- Attempt 3 — completed — `google/gemini-2.5-flash-lite` — session `ses_ccc`

The retry child sessions remain real, separate subagent sessions. The parent chat becomes the authoritative summary surface.

## Scope

### In scope

- Add structured retry-attempt history to `BackgroundTask`
- Update background retry lifecycle to record one attempt per child session
- Surface the attempt timeline in parent chat notifications
- Include session ids and model ids for each attempt

### Out of scope

- Redesigning the full session list UI
- Building a timeline into `background_output` in the first iteration
- Migrating historical tasks created before this feature
- Merging retry child sessions into one synthetic session

## Design Summary

### 1. Background task state model

Extend `BackgroundTask` with an `attempts` array.

Also add:

- `currentAttemptID?: string`

Each attempt must have its own immutable identity so async events from superseded child sessions cannot mutate the wrong attempt.

Each attempt should track:

- `attemptID: string`
- `attemptNumber: number`
- `sessionID?: string`
- `providerID?: string`
- `modelID?: string`
- `variant?: string`
- `status: "pending" | "running" | "completed" | "error" | "cancelled" | "interrupt"`
- `error?: string`
- `startedAt?: Date`
- `completedAt?: Date`

### Task-level invariants

`BackgroundTask` keeps existing top-level fields (`status`, `sessionID`, `model`, `startedAt`, `completedAt`, `error`) for compatibility, but they must be treated as a **projection of the current/latest attempt**.

Rules:

- `currentAttemptID` points at the only attempt allowed to receive active lifecycle updates
- task-level `sessionID`, `model`, `status`, `startedAt`, `completedAt`, and `error` must mirror the current/latest attempt state
- historical attempts are read-only once terminalized

This avoids two competing sources of truth.

This turns retry history into structured task state instead of a series of inferred notifications.

### 2. Attempt lifecycle

#### Initial launch

When a background task is first launched:

- create Attempt 1 in `pending`
- populate model information from the initial task model
- once `startTask()` creates the first child session, fill in `sessionID`, `startedAt`, and mark `running`
- set `currentAttemptID` to Attempt 1

#### Retry scheduled

When fallback retry is chosen:

- finalize the current attempt as failed using the latest error and completion time
- create the next attempt as `pending`
- populate its next fallback model metadata before queueing
- update `currentAttemptID` to the new attempt

The scheduler must pass the new `attemptID` forward to the later session-creation step. Binding must never target “the latest pending attempt” by inference.

The previously active attempt becomes immutable at this point.

#### Retry session ready

When `startTask()` creates the retry child session:

- bind the created child session to the exact scheduled `attemptID`
- assign the new `sessionID`
- set `startedAt`
- mark the attempt `running`

Binding rule:

- session creation must call something equivalent to `bindAttemptSession(attemptID, sessionID, ...)`
- binding succeeds only if that exact attempt is still the active pending/running attempt
- if the attempt is already superseded or terminal, the new session is aborted or ignored rather than rebound to another attempt

#### Final completion or failure

When the task finishes:

- mark the current attempt `completed`, `error`, `cancelled`, or `interrupt`
- record `completedAt`

### Pending sub-states

Internally, a `pending` attempt can represent different operational conditions:

1. queued behind concurrency
2. retry selected, new child session not yet created
3. session creation failed before a child session exists

The first iteration may still render all three as `pending` in the parent chat timeline, but the implementation should distinguish them in state transitions and notification text so debugging remains clear.

## Parent Chat Presentation

### Balanced default

The parent chat should show a balanced timeline by default:

- one line per attempt
- model id
- outcome
- session id

Example:

```text
Background task attempts:
- Attempt 1 — ERROR — openai/gpt-5.4-mini — ses_aaa
  Error: Forbidden: Selected provider is forbidden
- Attempt 2 — ERROR — anthropic/claude-haiku-4.5 — ses_bbb
  Error: Too Many Requests
- Attempt 3 — COMPLETED — google/gemini-2.5-flash-lite — ses_ccc
```

### Parent notification rules

The parent should receive three kinds of retry-related updates:

1. **Retry scheduled**
   - failed session id
   - failed model
   - failed error
   - next model

2. **Retry session ready**
   - retry session id
   - attempt number
   - model

3. **Final summary**
   - compact attempt timeline for all attempts

The final summary should be emitted for any terminal task outcome:

- completed
- error
- cancelled
- interrupt

The final summary is the user-facing source of truth.

## Data Ownership

`BackgroundTask` is the right owner for this state because:

- retries mutate and requeue the same background task id
- child sessions are implementation details of that task lifecycle
- parent notifications already derive from background task state

This avoids reconstructing attempt history from session logs or reminder text.

## Mutation contract

All attempt writes should go through a small set of helper functions owned by the background-task lifecycle.

Suggested helpers:

- `startAttempt(...)`
- `bindAttemptSession(...)`
- `scheduleRetry(...)`
- `finalizeAttempt(...)`

Also maintain a lightweight `sessionID -> attemptID` lookup for active and historical child sessions associated with the task lifecycle.

Rules:

- only the attempt referenced by `currentAttemptID` may receive active updates
- once an attempt is finalized, later events from its child session are ignored
- retry scheduling must finalize the old attempt before creating the next one
- every lifecycle handler must first resolve an immutable attempt identity, either directly by `attemptID` or through `sessionID -> attemptID`, before mutating attempt or task-level state

This is the key race-safety mechanism for async background retries.

## Key Integration Points

### Background retry path

- `src/features/background-agent/fallback-retry-handler.ts`
  - create the next attempt entry when retry is selected
  - finalize the failed attempt before queueing
  - record retry scheduling metadata without mutating historical attempts later

### Session creation path

- `src/features/background-agent/manager.ts`
  - in `startTask()`, attach the created child session id to the exact scheduled `attemptID`
  - emit the "retry session ready" reminder from attempt state

### Completion and failure path

- `src/features/background-agent/manager.ts`
  - update the active attempt status when task completes or errors
  - generate final parent summary from `attempts[]`
  - ignore stale events that target older attempt session ids
  - resolve every session lifecycle event through `sessionID -> attemptID` before applying updates

### Background output

Out of scope for the first iteration, but the same `attempts[]` state should make later extension straightforward.

## Error Handling

### Missing attempt session id

If session creation fails before a retry session exists:

- keep the attempt as `pending` until terminalized
- if the task fails permanently, mark that attempt `error` with no `sessionID`

### Late events from superseded sessions

If the old child session emits `session.error`, `message.updated`, `interrupt`, or other lifecycle events after a retry is already scheduled:

- those events must not mutate the newly active attempt
- they may be logged for debugging
- they must be ignored for task state purposes unless they resolve to the currently active `attemptID`

This means event handling must not rely on task-level `sessionID` alone. It must first map the incoming `sessionID` to the originating `attemptID`, then reject the mutation if that attempt is no longer current.

### Retry with no visible child session yet

This is expected between:

- old failed child abort
- new child session creation

The `Retry scheduled` notification should explain that the next attempt has been queued. The `Retry session ready` notification closes that observability gap.

## Testing Strategy

### Unit tests

- attempt created for first launch
- attempt finalized on retry scheduling
- retry attempt receives the newly created child `sessionID`
- final summary renders all attempts in order
- final summary preserves separate statuses for failed and successful attempts

### Regression tests

- forbidden initial provider followed by successful fallback should produce two attempts
- multiple failed retries followed by success should show full attempt chain
- background task failure with no fallback available should still produce one terminal attempt

## Risks

### Risk: status drift between task and attempts

Mitigation:

- centralize attempt updates in helper functions
- avoid manual field-by-field writes scattered across retry and completion code
- keep task-level fields as a projection, not an independent state machine

### Risk: duplicate retry attempt creation

Mitigation:

- create attempt entries only in the retry scheduling path
- use one active pending/running attempt at a time

### Risk: stale child-session events corrupt the latest attempt

Mitigation:

- require `attemptID`/`currentAttemptID`
- require `sessionID -> attemptID` lookup for all child-session lifecycle events
- finalize attempts immutably
- ignore late events from superseded session ids

### Risk: noisy parent chat

Mitigation:

- keep the final timeline compact
- use reminders only at retry boundaries and final completion

## Recommendation

Implement the attempt timeline as structured `BackgroundTask` state first, and derive parent chat summaries from that. This gives the cleanest UX while preserving separate retry child sessions and sets up future UI improvements without relying on fragile text parsing.
