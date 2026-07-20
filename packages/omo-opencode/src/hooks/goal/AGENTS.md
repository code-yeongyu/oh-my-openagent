# src/hooks/goal/ -- Persistent Per-Session Goal

**Generated:** 2026-07-17

## OVERVIEW

15 files (8 impl + 7 tests). The `goal` Session Tier hook (event-based). Replaces the user-facing `ralph-loop` wiring (PR #6184 "goal-replaces-ralph"): `ralphLoop` was removed from `HookNameSchema` and `create-session-hooks.ts`, and `ralph_loop` is now a deprecated config passthrough. The `ralph-loop/` dir + `createRalphLoopHook` factory remain for migration only.

A goal is a per-session persistent objective. While `status: active`, each `session.idle` re-injects a continuation prompt that drives the agent toward the objective and forbids marking complete without a completion audit. The continuation prompt surfaces `tokensUsed` / `timeUsedSeconds` from the goal record.

Opt-in: requires `goal.enabled: true` (config) AND the `goal` hook enabled. Wired in [`create-session-hooks.ts`](../../plugin/hooks/create-session-hooks.ts); event dispatched via `event-hook-dispatcher.ts`; tools registered in `tool-registry-core-tools.ts`; `/goal` command parsed in `command-execute-before.ts` and `chat-message/loop-commands.ts`.

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | `createGoalHook(ctx, options) -> GoalHook`. `event` handler for `session.idle` (continuation) and `session.deleted` (clear). Re-entry guarded by `inFlightContinuations` Set |
| `controller.ts` | `createGoalController({projectDir})`. CRUD: set/get/pause/resume/clear/markComplete + `accountUsage` (token/time accrual, controller-only) + `updateTui`. Writes TUI mirror |
| `store.ts` | File persistence. Atomic write (tmp + rename). `readGoal` returns null on ENOENT or parse/schema failure. `STORE_VERSION = 1` |
| `types.ts` | Zod schemas: `GoalSchema`, `GoalStatusSchema` (`active|paused|complete`), `GoalFileSchema` (v1), tool snapshot/response schemas |
| `prompt.ts` | `buildContinuationPrompt` / `buildResumePrompt`. Objective wrapped in `<untrusted_objective>` (XML-escaped). Enforces completion audit before `update_goal status:complete` |
| `tools.ts` | `createGoalTools` -> `create_goal`, `update_goal`, `get_goal` ToolDefinitions. `session_id` optional (defaults to current session) |
| `validation.ts` | `validateObjective`: trim, non-empty, max 2000 chars. `InvalidObjectiveError` |
| `command-arguments.ts` | `parseGoalCommand` -> `show | clear | setStatus(active|paused) | setObjective` |

## STATE

- Primary: `.omo/goal/{encodeURIComponent(sessionID)}.json` (atomic).
- TUI mirror: `.omo/ulw-loop/{sessionID}/goals.json` (`TuiLoopSnapshot` v1), rewritten on every mutation.
- `session.deleted` clears the goal file.

## INTERFACE

```typescript
interface GoalHook {
  setGoal(sessionID, objective): Goal
  getGoal(sessionID): Goal | null
  pauseGoal(sessionID): Goal | null
  resumeGoal(sessionID): Goal | null
  clearGoal(sessionID): boolean
  markComplete(sessionID): Goal | null
  event(input): Promise<void>   // session.idle + session.deleted
}
```

## CONTINUATION DISPATCH

`session.idle` -> `buildContinuationPrompt(goal)` -> `dispatchInternalPrompt` (async gate, `settleMs: 150`, `queueBehavior: "defer"`, source `goal:idle-continuation`). Dispatch failures log via `console.warn` only; the prompt may still be accepted by another route. `inFlightContinuations` prevents re-entrant dispatches per session.

## NOTES

- `default_mode.goal: true` auto-creates a goal from the first main-session message (`chat-message/loop-commands.ts`).
- `accountUsage` accrues only while `status === active`; paused goals keep their accumulated totals.
- Ralph Loop behavioral parity preserved via `default_max_iterations` (default 100).
