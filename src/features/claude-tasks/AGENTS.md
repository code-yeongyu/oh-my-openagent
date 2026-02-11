# CLAUDE TASKS KNOWLEDGE BASE

## OVERVIEW

Claude Code compatible task schema and storage. Core task management with file-based persistence and atomic writes.

## STRUCTURE
```
claude-tasks/
├── types.ts               # Task schema (Zod)
├── types.test.ts          # Schema validation tests
├── storage.ts             # File operations (atomic write, locking)
├── storage.test.ts        # Storage tests (30 tests, 543 lines)
├── session-storage.ts     # Session-scoped task storage
├── session-storage.test.ts
└── index.ts               # Barrel exports
```

## TASK SCHEMA

```typescript
type TaskStatus = "pending" | "in_progress" | "completed" | "deleted"
interface Task {
  id: string                    // T-{uuid}
  subject: string               // Imperative: "Run tests"
  description: string
  status: TaskStatus
  activeForm?: string           // Present continuous: "Running tests"
  blocks: string[]              // Task IDs this task blocks
  blockedBy: string[]           // Task IDs blocking this task
  owner?: string                // Agent name
  metadata?: Record<string, unknown>
  repoURL?: string
  parentID?: string
  threadID?: string
}
```

## STORAGE UTILITIES

| Function | Purpose |
|----------|---------|
| `getTaskDir(config)` | Task storage directory path |
| `resolveTaskListId(config)` | Task list ID (env → config → cwd) |
| `readJsonSafe(path, schema)` | Parse + validate, null on failure |
| `writeJsonAtomic(path, data)` | Atomic write via temp + rename |
| `acquireLock(dirPath)` | File lock with 30s stale threshold |
| `generateTaskId()` | `T-{uuid}` format |
| `findTaskAcrossSessions(config, taskId)` | Locate task in any session |

## TODO SYNC

Automatic bidirectional synchronization between tasks and OpenCode's todo system.

| Function | Purpose |
|----------|---------|
| `syncTaskToTodo(task)` | Convert Task to TodoInfo, returns `null` for deleted tasks |
| `syncTaskTodoUpdate(ctx, task, sessionID, writer?)` | Fetch current todos, update specific task, write back |
| `syncAllTasksToTodos(ctx, tasks, sessionID?)` | Bulk sync multiple tasks to todos |

### Status Mapping

| Task Status | Todo Status |
|-------------|-------------|
| `pending` | `pending` |
| `in_progress` | `in_progress` |
| `completed` | `completed` |
| `deleted` | `null` (removed from todos) |

### Field Mapping

| Task Field | Todo Field |
|------------|------------|
| `task.id` | `todo.id` |
| `task.subject` | `todo.content` |
| `task.status` (mapped) | `todo.status` |
| `task.metadata.priority` | `todo.priority` |

Priority values: `"low"`, `"medium"`, `"high"`

### Automatic Sync Triggers

Sync occurs automatically on:
- `task_create` — new task added to todos
- `task_update` — task changes reflected in todos

## ANTI-PATTERNS

- Direct fs operations (use storage utilities)
- Skipping lock acquisition for writes
- Using old field names (title → subject, dependsOn → blockedBy)
