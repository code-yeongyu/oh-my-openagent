# CLAUDE TASKS FEATURE KNOWLEDGE BASE

## OVERVIEW

Claude Code compatible task schema and storage. Provides core task management utilities used by task-related tools and features.

## STRUCTURE

```
claude-tasks/
├── types.ts          # Task schema (Zod)
├── types.test.ts     # Schema validation tests (8 tests)
├── storage.ts        # File operations
├── storage.test.ts   # Storage tests (14 tests)
└── index.ts          # Barrel exports
```

## TASK SCHEMA

```typescript
type TaskStatus = "pending" | "in_progress" | "completed" | "deleted"

interface Task {
  id: string
  subject: string           // Imperative: "Run tests" (was: title)
  description: string
  status: TaskStatus
  activeForm?: string       // Present continuous: "Running tests"
  blocks: string[]          // Task IDs this task blocks
  blockedBy: string[]       // Task IDs blocking this task (was: dependsOn)
  owner?: string            // Agent name
  metadata?: Record<string, unknown>
  repoURL?: string          // oh-my-opencode specific
  parentID?: string         // oh-my-opencode specific
  threadID: string          // oh-my-opencode specific
}
```

**Key Differences from Legacy**:
- `subject` (was `title`)
- `blockedBy` (was `dependsOn`)
- `blocks` (new field)
- `activeForm` (new field)

## TODO SYNC

The task system includes a sync layer (`todo-sync.ts`) that automatically mirrors task state to the project's Todo system.

- **Creation**: Creating a task via `task_create` adds a corresponding item to the Todo list.
- **Updates**: Updating a task's `status` or `subject` via `task_update` reflects in the Todo list.
- **Completion**: Marking a task as `completed` automatically marks the Todo item as done.

## STORAGE UTILITIES

### getTaskDir(config)

Returns the task storage directory path.

**Default behavior (no config override):**
Returns `~/.config/opencode/tasks/<task-list-id>/` where:
- Task list ID is resolved via `resolveTaskListId()`

**With `storage_path` config:**
- Absolute paths (starting with `/`) are returned as-is
- Relative paths are joined with `process.cwd()`

### resolveTaskListId(config)

Resolves the task list ID for directory scoping.

**Priority order:**
1. `ULTRAWORK_TASK_LIST_ID` environment variable
2. `config.sisyphus?.tasks?.task_list_id` config option
3. Sanitized `basename(process.cwd())` as fallback

**Sanitization:** Replaces non-alphanumeric characters (except `-` and `_`) with `-`

### readJsonSafe(filePath, schema)

- Returns parsed & validated data or `null`
- Safe for missing files, invalid JSON, schema violations

### writeJsonAtomic(filePath, data)

- Atomic write via temp file + rename
- Creates parent directories automatically
- Cleans up temp file on error

### acquireLock(dirPath)

- File-based lock: `.lock` file with timestamp
- 30-second stale threshold
- Returns `{ acquired: boolean, release: () => void }`

## TESTING

**types.test.ts** (8 tests):
- Valid status enum values
- Required vs optional fields
- Array validation (blocks, blockedBy)
- Schema rejection for invalid data

**storage.test.ts** (14 tests):
- Path construction
- Safe JSON reading (missing files, invalid JSON, schema failures)
- Atomic writes (directory creation, overwrites)
- Lock acquisition (fresh locks, stale locks, release)

## USAGE

```typescript
import { TaskSchema, getTaskDir, readJsonSafe, writeJsonAtomic, acquireLock } from "./features/claude-tasks"

const taskDir = getTaskDir(config)
const lock = acquireLock(taskDir)

try {
  const task = readJsonSafe(join(taskDir, "1.json"), TaskSchema)
  if (task) {
    task.status = "completed"
    writeJsonAtomic(join(taskDir, "1.json"), task)
  }
} finally {
  lock.release()
}
```

## ANTI-PATTERNS

- Direct fs operations (use storage utilities)
- Skipping lock acquisition for writes
- Ignoring null returns from readJsonSafe
- Using old schema field names (title, dependsOn)
