# boulder-state — Work-Tracking State Machine (Core)

**Generated:** 2026-07-17 / 7d664b96b

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

- **omo-opencode** (`workspace:*`): `features/boulder-state/*` re-exports; hooks `atlas`, `start-work`, `todo-continuation-enforcer`; CLI `boulder` command.
- **omo-codex** (`file:` dep): `plugin/components/start-work-continuation/boulder-reader.ts`.
- **omo-senpi** (`workspace:*`): `src/components/start-work-continuation/boulder-eligibility.ts` reads work state with `senpi:`-prefixed session ids.

## NOTES

- **Prototype-pollution guard:** `RESERVED_KEYS = {__proto__, prototype, constructor}` — task upserts reject matching keys.
- **Session IDs are normalized** with an `opencode:` / `codex:` / `senpi:` prefix (`normalizeSessionId`). Senpi callers must pass a pre-prefixed `senpi:<id>` to read APIs such as `getWorkForSession`; the default platform stays `opencode`.
- **`readBoulderState` rejects empty `{}`** as invalid (returns null), alongside non-object and array payloads.
- **`writeBoulderState` self-creates `.omo/.gitignore`** (`*`, `!/rules/`) on first `mkdir`.
- **Plan parsing** has two modes: structured (when `## TODOs` / `## Final Verification Wave` headings exist) counts only numbered `- [ ] N.` / `F1.` items inside those sections; otherwise a simple mode counts any top-level `-`/`*` checkbox. Code fences and indented checkboxes are skipped.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
