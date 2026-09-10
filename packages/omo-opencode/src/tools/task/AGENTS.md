# src/tools/task/ -- task_* Tools + Todo Synchronization

**Generated:** 2026-09-10

**Score:** 13 (13 files, ~3.1k LOC, module boundary, schema-first domain distinct from the delegation `task` tool)

## OVERVIEW

The four `task_*` tools of the Sisyphus task system (gated by `experimental.task_system`). Unrelated to `delegate-task/`, which owns the `task` delegation tool. Task state is JSON files under the Claude task directory; this directory holds validation, tool schemas, and the todo bridge.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Zod schemas + inferred types | `types.ts` (`TaskObjectSchema` is `.strict()`; `TaskSchema`/`Task` are Claude-style aliases) |
| Create / read / list / update | `task-create.ts`, `task-get.ts`, `task-list.ts`, `task-update.ts` |
| Todo mirroring | `todo-sync.ts` (`syncTaskToTodo`, `syncTaskTodoUpdate`, `syncAllTasksToTodos`) |
| Storage primitives | `../../features/claude-tasks/storage` (`getTaskDir`, `acquireLock`, `writeJsonAtomic`, `readJsonSafe`, `generateTaskId`) |

## CONVENTIONS

- Tools return JSON strings, never throw: failures surface as `{"error":"..."}` with codes such as `task_lock_unavailable`, `task_not_found`, `invalid_task_id`, `validation_error`.
- Task IDs match `^T-[A-Za-z0-9-]+$` and are validated before any file path is built.
- Writes take the directory lock, mutate, then release in `finally`; every write goes through `writeJsonAtomic`.
- `threadID` is always the calling `sessionID`; `blocks`/`blockedBy` are additive through `addBlocks`/`addBlockedBy`, never replaced.
- `metadata` merges into the existing record; a `null` value deletes the key.
- `task_list` hides `completed`/`deleted` tasks and filters `blockedBy` down to unresolved blockers so parallelizable work is visible.

## TODO BRIDGE

`todo-sync.ts` resolves OpenCode's `Todo.update` lazily through a dynamic import and silently no-ops when it is unavailable, so task operations never fail because the todo API moved. `deleted` tasks map to no todo and are removed by id, or by content when the existing todo has no id.

## ANTI-PATTERNS

- Do not write task JSON directly; bypassing the lock plus atomic write corrupts concurrent updates.
- Do not add fields without extending `TaskObjectSchema`: the strict schema rejects unknown keys at parse time.
