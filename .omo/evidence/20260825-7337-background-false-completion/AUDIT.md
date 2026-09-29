# Independent Audit - #7337 background-task false completion

Auditor: fresh review session (no prior worker state reused). Branch `fix/7337-background-task-false-completion`.

## Issue contract (derived from #7337)

- A background task may publish `completed` only when its terminal child session has a genuine terminal assistant result (verified session content).
- Outputless / user-only / indeterminate terminal sessions must NOT false-complete; they follow a bounded, diagnostic failure path (fail now, or keep waiting under the existing stale/TTL bounds) without disturbing sibling tasks.
- Startup failures must carry structured diagnostics; siblings unaffected; repeated polling idempotent.

## Completion-publisher map (audited)

Single publisher of `completed`: `tryCompleteTask()` (manager.ts). Three gated routes into it:

1. Polling route A - terminal non-idle status (`interrupted`): candidate patch validates output; no-output -> teardown + `failCrashedTask`. NEW in this diff.
2. Polling route B - idle / gone-from-status: validates output; no-output waits or fails-if-gone. Pre-existing.
3. Event route - `session.idle` -> `handleSessionIdleBackgroundEvent`: validates output; no-output waits. Pre-existing.

Bounded failure paths verified: stale interrupts (`checkAndInterruptStaleTasks` -> cancelled + diagnostic), TTL prune (`pruneStaleTasksAndNotifications` -> error + diagnostic), session-gone threshold + existence check -> `failCrashedTask`.

## Findings

### F1 (P0 defect - fetch/error semantics)
`validateSessionHasOutput()` catches messages-fetch errors and returns `true` ("allow completion"). All three gates therefore treat an INDETERMINATE observation as verified output and can publish `completed` for a session whose contents could never be inspected. Direct violation of the issue contract ("indeterminate ... must not false-complete").
Fix: tri-state `resolveSessionOutputState()` = `"output" | "no-output" | "unknown"`; boolean wrapper maps unknown->false so routes B/C wait (bounded by stale/TTL diagnostics); route A fails only on verified `no-output`, waits on `unknown`.
RED tests: T1 (route A), T2 (event route), T4 (route B) with throwing messages client.

### F2 (P1 defect - race/idempotence)
`failCrashedTask()` lacks the `task.status !== "running"` entry guard that `tryCompleteTask()` has. In route A's failure path, between the post-validate recheck and `failCrashedTask`, two awaits (session abort up to 10s timeout + tmux pane callback) allow a concurrent completion (e.g. late tool output marks output observed, then session.idle event completes the task) to be overwritten to `error`, double-notifying the parent (result-ready AND error).
Fix: mirror tryCompleteTask's guard at failCrashedTask entry.
RED test: T3 - deterministic flip of task status to `completed` inside the `onSubagentSessionDeleted` callback; assert status stays `completed`, no error overwrite.

### F3 (accepted, documented)
Tool-only content counts as valid output; an `interrupted` session with partial output completes. Pre-existing predicate shared by all routes, documented in feature AGENTS.md; changing it would alter shipped behavior beyond #7337's user-only false-completion contract.

### F4 (doc)
Feature AGENTS.md paragraph gains one clause: indeterminate observations (messages fetch error) keep the task waiting under existing bounded timeouts.

## Execution order

1. RED: add T1/T2/T3/T4 to manager.polling.test.ts; run; confirm each fails for the defect it names.
2. GREEN: minimal manager.ts fixes (F1 tri-state + F2 guard).
3. Doc: AGENTS.md clause (F4).
4. Gates: focused tests x2 post-final-edit, `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`, `git diff --check`, hygiene greps, isolated OpenCode QA lane.
5. Two consecutive clean audit waves over final tree.
