# boulder-state — Work-Tracking State Machine (Core)

**Generated:** 2026-08-24 / f3642fcda

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
| **Stale works** (`storage/stale-work.ts`) | `reconcileStaleWorks`, `isWorkStale`, `resolveStaleWorkThresholdMs`, `DEFAULT_STALE_WORK_THRESHOLD_MS`, `STALE_WORK_THRESHOLD_ENV_KEY` |
| **Plans** (`plan-checklist.ts`, `top-level-task.ts`, `storage/plan-progress.ts`) | `getPlanChecklist`, `parsePlanChecklist`, `readCurrentTopLevelTask`, `findPrometheusPlans`, `getPlanProgress`, `getPlanName` |
| **Paths** (`storage/path.ts`) | `getBoulderFilePath`, `resolveBoulderPlanPath(ForWork)` |

## CONSUMERS

- **omo-opencode** (`workspace:*`): `features/boulder-state/*` re-exports; hooks `atlas`, `ulw-execute`, `todo-continuation-enforcer`; CLI `boulder` command.
- **omo-codex** (`file:` dep): `plugin/components/ulw-execute-continuation/boulder-reader.ts`.
- **omo-senpi** (`workspace:*`): `src/components/ulw-execute-continuation/boulder-eligibility.ts` reads work state with `senpi:`-prefixed session ids.
- Both ulw-execute read paths (`omo-opencode` hook, `omo-senpi` continuation component) call `reconcileStaleWorks` first and pass the agent sessions directory resolved by `omo-senpi`'s `resolveAgentSessionsDirectory`; this package resolves no home path of its own.

## NOTES

- **Prototype-pollution guard:** `RESERVED_KEYS = {__proto__, prototype, constructor}` — task upserts reject matching keys.
- **Session IDs are normalized** with an `opencode:` / `codex:` / `senpi:` prefix (`normalizeSessionId`). Senpi callers must pass a pre-prefixed `senpi:<id>` to read APIs such as `getWorkForSession`; the default platform stays `opencode`.
- **`readBoulderState` rejects empty `{}`** as invalid (returns null), alongside non-object and array payloads.
- **Stale works:** `completeBoulder` is the only completion transition, so a work whose session died abnormally would stay `active` forever (#8413). `reconcileStaleWorks(directory, options?)` demotes an `active` work to `paused` and stamps `stale_since` when its last activity - the newest of its sessions' transcript mtimes, `updated_at` and `started_at` - is at least `OMO_BOULDER_STALE_WORK_THRESHOLD_MS` (default 6h) old; a work with no activity evidence at all is stale. Nothing stale means no write, `completed`/`abandoned` and status-less records are never touched, and every failure is swallowed. Transcripts are read only under session directories whose alphanumeric shape matches the work's own cwd or worktree, because an agent home accumulates thousands of them. `selectActiveWork`/`appendSessionIdForWork` return a `stale_since` work to `active` and drop the stamp; a work paused without the stamp keeps its status. Readers are unchanged - `getActiveWorks`/`getWorkResumeOptions` still filter `completed`/`abandoned` only.
- **`writeBoulderState` self-creates `.omo/.gitignore`** (`*`, `!/rules/`) on first `mkdir`.
- **Plan parsing** has two modes: structured (when `## TODOs` / `## Final Verification Wave` headings exist) counts only labeled rows inside those sections (`N` / `T<n>[.<n>[a]]` under TODOs, `F<n>` / `H<n>` under the final wave, followed by `.`, space, `-` or em-dash); otherwise a simple mode counts any top-level `-`/`*` checkbox. A structured parse that counts nothing while top-level checkboxes exist under another heading falls back to simple mode. `[x]` is completed, `[ ]` is remaining, and `[~]` (blocked) counts toward the total only, so it never keeps a continuation alive. `isStructuredTaskRow` exposes the row grammar to the OpenCode plan-format validator; the Codex Stop hook keeps its own copy in `omo-codex/plugin/components/ulw-execute-continuation/src/plan-checklist.ts`. Code fences (`markdown-fence.ts`) and indented checkboxes are skipped.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
