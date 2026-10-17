# Plan - issue 6517: turn stays parked after a hook-stopped continuation until the user sends a message

## Root cause (traced end-to-end in this worktree, not from memory)

Issue 6517 reports: after a turn ends via `hook_stopped_continuation` (the harness stopped
the turn; the tool result is already available), the session is sometimes never re-invoked.
The UI keeps showing "working" with no live stream until the user manually sends a message.

In-repo mapping (the literal `hook_stopped_continuation` string is harness-side; verified
absent from this repo via `GIT_MASTER=1 git grep` across all history):

- The main-session continuation mechanism is `todoContinuationEnforcer`
  (`packages/omo-opencode/src/hooks/todo-continuation-enforcer/`). On `session.idle` with
  incomplete todos it injects a continuation prompt through the mandated
  `dispatchInternalPrompt` gate (`packages/utils/src/prompt-async-gate/`).
- The gate can decline a dispatch with TRANSIENT statuses:
  - `"reserved"` - another dispatcher holds the reservation, including the 2s post-dispatch
    hold window (`session-idle-dispatch.ts:46-55`, `reservations.ts`);
  - `"active"` - live session status still busy/retry/running, or the latest assistant turn
    still looks blocking (`session-idle-dispatch.ts:72-110`,
    `pending-tool-turn.ts:65-116`). A hook-stopped turn is exactly the shape that leaves a
    transiently-blocking latest message or a lagging status.
- Drop point: `continuation-injection.ts:255-261`. EVERY non-accepted status is treated the
  same: one log line, `inFlight = false`, return. No retry, no cooldown update, no timer.
  The triggering `session.idle` has already been consumed, so unless another idle event
  arrives (it does not, in the parked state), the continuation is lost and the turn stays
  parked until the user types - the reported bug.
- Every sibling wake path already retries this exact decline:
  - atlas: `hooks/atlas/idle-continuation.ts:124-132` returns `skipped_active_session` ->
    `scheduleRetry` (RETRY_DELAY_MS timer, bounded by MAX_CONSECUTIVE_PROMPT_FAILURES);
  - parent-wake: `features/background-agent/parent-wake-prompt-dispatch.ts:93-101` requeues
    + flush runner with a 60s active-defer ceiling;
  - monitor: `features/monitor/output-injector.ts` scheduleFlush while active.
  The boulder enforcer is the odd one out.

## Fix (minimal, root-cause-scoped)

Bounded watchdog retry for TRANSIENT gate declines in the boulder injection path. The gate
stays authoritative: every retry re-runs the full guard chain (cancel/stop/bg-tasks/todos/
agent/block-reason) plus the gate itself, so a genuinely live session can never be
double-injected; only the silent loss of the wake is removed.

1. `constants.ts`: add `GATE_RETRY_DELAY_MS = 5_000` and `MAX_GATE_RETRIES = 3`.
2. NEW `gate-retry.ts`:
   - `isTransientGateDecline(status)` - true for `"active"` | `"reserved"` only
     (`"cancelled"` / `"unavailable"` are deliberate/permanent and keep today's behavior).
   - `scheduleGateRetry({ sessionID, state, reason, inject })` - dedupe-safe (one pending
     timer per session), budget-bounded (`state.gateRetryCount`), stores the timer on
     `state.gateRetryTimer`, fires `inject()` once after the delay. Takes the retry thunk
     as a parameter so it has no import cycle with `continuation-injection.ts`.
3. `types.ts`: `SessionState` gains optional `gateRetryTimer` and `gateRetryCount`.
4. `session-state.ts` `cancelCountdown()`: clear `gateRetryTimer` and reset
   `gateRetryCount = 0`. This gives every fresh idle cycle its own bounded budget and ties
   retry teardown into every existing stop path (abort/token-limit/unrecoverable via
   handler.ts, `/stop-continuation` via cancelAllCountdowns, prune TTL, shutdown, dispose).
5. `continuation-injection.ts`:
   - non-accepted branch: when `isTransientGateDecline(status)`, call `scheduleGateRetry`
     with a thunk that re-runs `injectContinuation` with the original args;
   - accepted + ambiguous-failure branches: reset `gateRetryCount = 0`.
6. `AGENTS.md` (hook dir): sync STATE PER SESSION list + one line in HOW IT WORKS.

Watchdog window: up to 3 retries at 5s spacing (~15s after the declined injection) -
directly implements the issue's suggested direction "if no re-invoke has been issued
within N seconds, issue it", sized to cover reservation holds (2s) and status/settle lag.

## Verification

- RED first: new tests in `continuation-injection.test.ts` using the established
  fake-timers pattern from `todo-continuation-enforcer.test.ts`:
  1. gate declines "active" -> retry fires after GATE_RETRY_DELAY_MS and dispatches once
     the status settles to idle (fails on current code: prompt never dispatched);
  2. gate declines "reserved" (peer-message hold, same setup as the existing peer-hold
     test) -> retry dispatches after the hold is released;
  3. budget bound: permanent "active" -> exactly MAX_GATE_RETRIES retries, then stops,
     no dangling timer;
  4. non-transient decline ("unavailable": no promptAsync on client) -> no retry timer;
  5. `cancelCountdown()` clears a pending retry timer (abort/stop paths tear down).
- Focused gates run TWICE over the identical final tree:
  `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer` +
  `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` +
  `GIT_MASTER=1 git diff --check` + hygiene grep on changed paths.
- Real-surface QA under `/tmp/opencode/issue-6517/` with sandboxed
  XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/XDG_CACHE_HOME/HOME; isolation proven by
  mtime snapshot of real ~/.omo, ~/.senpi, ~/.config/opencode, ~/.codex, ~/.cache/opencode
  before/after.

## Out of scope (documented, not fixed here)

- goal idle continuation, team-idle-wake-hint, and claude-code Stop-hook inject-prompt are
  also single-shot on gate decline, but they are config-gated surfaces (goal.enabled off,
  team_mode off, CC hooks require user settings.json) and not the main-session path from
  the issue. Touching them would widen the blast radius without addressing the reported
  surface.
- Force-dispatching past a permanently stale "busy" status (parent-wake's 60s ceiling
  pattern) is deliberately NOT added: bypassing the gate status check can double-inject a
  live session, which the prompt-async-gate RFC forbids. Residual risk recorded honestly
  in README.md.
