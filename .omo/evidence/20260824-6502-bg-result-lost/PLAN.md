# Plan — fix #6502 background_output loses completed-task results after cleanup

## Root cause (file:line)

1. `packages/omo-opencode/src/features/background-agent/manager.ts:2324-2361`
   `scheduleTaskRemoval()` evicts terminal tasks from the live `tasks` map via
   `removeTask()` (:2350) after `TASK_CLEANUP_DELAY_MS` (10 min,
   `constants.ts:16`).
2. Post-eviction resolvability relies on two in-memory archives with holes:
   - `archiveCompletedTask()` `manager.ts:441-475`: skips tasks without
     `sessionId` (:442-444) and silently drops the `result` payload (the
     archived literal at :449-464 has no `result` key); capped at
     `MAX_COMPLETED_TASK_ARCHIVE_SIZE = 100` (:230).
   - `archiveBackgroundTask()` `task-registry.ts:105-114`: same sessionId gate;
     registry cap 100 (:3); the whole registry lives on `globalThis`, so plugin
     reload / process restart loses every bg_ id while the session DB persists.
3. Lookup side `packages/omo-opencode/src/tools/background-task/create-background-output.ts`:
   resolves ONLY through `manager.getTask(bg_id)` (:54, :65). A `ses_` id is
   rejected outright by `formatTaskNotFoundMessage()` (:81-91) with no reverse
   lookup, although `findBySession()` (`manager.ts:1140`) can resolve live
   tasks by session id.

Net effect: "complete task -> later lookup still returns result" fails when
(a) the task reached terminal state without a sessionId, (b) archive caps
evicted the entry, (c) the process reloaded, or (d) the caller only holds the
ses_ id from launch metadata.

## Fix (minimal diff, mirrors open prior art PR #7186 style)

1. `manager.ts`: retain `result` in the archived copy; add public
   `getTaskBySessionId(sessionID)` = `findBySession` ?? archive scan ?? new
   registry scan.
2. `task-registry.ts`: add `findRegisteredBackgroundTaskBySessionId()`.
3. `tools/background-task/clients.ts`: extend `BackgroundOutputManager` Pick
   with `"getTaskBySessionId"`.
4. `create-background-output.ts`: add `resolveTask()` (direct bg_ lookup, then
   session-ID reverse lookup with the same missing-retry semantics); enrich
   not-found guidance for both ses_ and bg_ misses; accept ses_ ids in the arg
   description.
5. Tests: failing-first regression tests (new files), then update existing
   `BackgroundOutputManager` mock literals (5 test files) for the widened Pick
   and the metadata wording assertion.

## Verification

- Scoped: `bun test` on the two new files + the 5 touched test files.
- `bun run typecheck`.
- Known pre-existing failure NOT in scope: omo-native payload.test.ts.
