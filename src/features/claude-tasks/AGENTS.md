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
├── todo-sync.ts      # Task → Todo synchronization
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

Task system includes sync layer (`todo-sync.ts`) that automatically mirrors task state to the project's Todo system.

- **Creation**: `task_create` adds corresponding Todo item
- **Updates**: `task_update` reflects in Todo list
- **Completion**: `completed` status marks Todo item done

## STORAGE UTILITIES

| Function | Purpose |
|----------|---------|
| `getTaskDir(config)` | Returns task storage directory path |
| `resolveTaskListId(config)` | Resolves task list ID (env → config → cwd basename) |
| `readJsonSafe(path, schema)` | Parse + validate, returns null on failure |
| `writeJsonAtomic(path, data)` | Atomic write via temp file + rename |
| `acquireLock(dirPath)` | File-based lock with 30s stale threshold |

## ANTI-PATTERNS

- Direct fs operations (use storage utilities)
- Skipping lock acquisition for writes
- Ignoring null returns from readJsonSafe
- Using old schema field names (title, dependsOn)
