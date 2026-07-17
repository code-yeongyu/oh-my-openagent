# src/features/boulder-state/ — Active Work Plan Tracker

**Generated:** 2026-07-17 / 7d664b96b

## OVERVIEW

10 files (~1k LOC excl. tests). Tracks Sisyphus's "boulder" — the active work plan being rolled across sessions, worktrees, and subagent task delegations. Named after the Sisyphus myth: the boulder must keep rolling until the plan is complete.

Inspected interactively via `bunx oh-my-opencode boulder` (see [`src/cli/boulder/`](../../cli/boulder)).

## SCHEMA (v2)

```typescript
interface BoulderState {
  schema_version?: 2
  active_work_id?: string
  works?: Record<string, BoulderWorkState>
  active_plan: string                            // absolute path to active .md plan
  started_at: string                             // ISO timestamp
  ended_at?: string
  elapsed_ms?: number
  status?: "active" | "completed" | "paused" | "abandoned"
  session_ids: string[]                          // every session that has rolled the boulder
  session_origins?: Record<string, "direct" | "appended">
  plan_name: string                              // filename of active_plan
  agent?: string                                 // resume agent (atlas | sisyphus | ...)
  worktree_path?: string                         // git worktree root
  task_sessions?: Record<string, TaskSessionState>  // reusable subagent sessions per top-level task
}
```

## FILES

| File | Purpose |
|------|---------|
| `types.ts` | `BoulderState`, `BoulderWorkState`, `TaskSessionState`, status enums |
| `storage.ts` | Atomic CRUD on `.omo/boulder.json`. Writes via temp file + rename; file lock per work_id |
| `constants.ts` | Path resolution + schema version constant |
| `top-level-task.ts` | Helpers to identify the current top-level plan task and resolve its reusable subagent session |
| `format-duration.ts` | `formatDurationHuman(ms)` — "1h 23m 5s" formatting for boulder duration |
| `index.ts` | Barrel exports |

## LIFECYCLE

```
session.startWork(plan)
  → BoulderState created with active_plan, started_at, plan_name
  → atlas-hook reads BoulderState + `task_sessions` on session.idle (boulder continuation + subagent resume)
session.idle (incomplete plan)
  → todoContinuationEnforcer + atlasHook inspect state
  → Inject CONTINUATION_PROMPT or BOULDER_COMPLETE_PROMPT
session.completed
  → BoulderState status="completed", ended_at, elapsed_ms recorded
```

## INTEGRATION POINTS

| Where | What |
|-------|------|
| [`src/cli/boulder/`](../../cli/boulder) | CLI inspector formats this state |
| [`src/hooks/atlas/`](../../hooks/atlas) | Reads work state + `task_sessions` (subagent resume); drives boulder-complete and parallel-delegation prompts |
| [`src/hooks/start-work/`](../../hooks/start-work) | Creates the BoulderState on `/start-work` invocation |
| [`src/hooks/todo-continuation-enforcer/`](../../hooks/todo-continuation-enforcer) | Session-idle continuation when boulder incomplete |

## STORAGE

```
<worktree-root>/.omo/boulder.json   # gitignored; one file per worktree
```

Atomic writes: temp file → fsync (where supported) → rename. File lock prevents concurrent corruption. Schema migrations between versions handled inline in `storage.ts`.

## NOTES

- **task_sessions reuse**: same subagent session is reused across iterations for the same top-level task to preserve context.
- **Multi-work**: `works` map allows tracking multiple concurrent plans; `active_work_id` selects the current one.
- **Worktree-scoped**: state lives in the worktree, not user-global; ensures parallel work plans across worktrees stay isolated.
