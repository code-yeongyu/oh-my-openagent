# boulder-state — Work-Tracking State Machine (Core)

**Generated:** 2026-06-17

## OVERVIEW

Tracks the active work plan (the "boulder") across sessions, worktrees, and subagent task delegations. State persists in `<worktree-root>/.omo/boulder.json` (`schema_version: 2`). Zero npm dependencies — pure functional state machine over JSON. Package: `@oh-my-opencode/boulder-state`.

## STATE MODEL

Every `BoulderState` carries `active_work_id` + a `works` map. The root-level fields (`active_plan`, `plan_name`, `status`, `session_ids`, `task_sessions`, …) are a **mirror** of the currently active work. `selectMirrorWork()` picks the active work (by id, else most-recently-updated); `projectWorkToMirror()` copies it to root; `writeBoulderState()` syncs root → work entry before serialization. Legacy single-work states with no `works` map auto-upgrade via `getBoulderWorks()`.

## PUBLIC API (`src/index.ts`)

| Area | Functions |
|------|-----------|
| **Read** (`storage/read-state.ts`) | `readBoulderState`, `getBoulderWorks`, `getActiveWorks`, `getWorkById/ByPlanName/ForSession`, `getWorkResumeOptions`, `getTaskSessionState` |
| **Write** (`storage/write-state.ts`) | `writeBoulderState`, `clearBoulderState`, `createBoulderState`, `addBoulderWork`, `completeBoulder`, `selectActiveWork`, `generateWorkId` |
| **Sessions/tasks** (`storage/{session,task}.ts`) | `appendSessionId(ForWork)`, `upsertTaskSessionState(ForWork)`, `startTaskTimer`, `endTaskTimer` |
| **Plans** (`plan-checklist.ts`, `top-level-task.ts`, `storage/plan-progress.ts`) | `getPlanChecklist`, `parsePlanChecklist`, `readCurrentTopLevelTask`, `findPrometheusPlans`, `getPlanProgress`, `getPlanName` |
| **Paths** (`storage/path.ts`) | `getBoulderFilePath`, `resolveBoulderPlanPath(ForWork)` |

## CONSUMERS

- **omo-opencode** (`workspace:*`): `features/boulder-state/*` re-exports; hooks `atlas`, `ralph-loop`, `start-work`, `todo-continuation-enforcer`; CLI `boulder` command.
- **omo-codex** (`file:` dep): `plugin/components/start-work-continuation/boulder-reader.ts`.

## NOTES

- **Prototype-pollution guard:** `RESERVED_KEYS = {__proto__, prototype, constructor}` — task upserts reject matching keys.
- **Session IDs are normalized** with an `opencode:` / `codex:` prefix (`normalizeSessionId`).
- **`writeBoulderState` self-creates `.omo/.gitignore`** (`*`, `!/rules/`) on first `mkdir`.
- **Plan parsing** recognizes only `## TODOs` and `## Final Verification Wave` sections; counts numbered `1.`/`F1.` items, skips indented checkboxes.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
