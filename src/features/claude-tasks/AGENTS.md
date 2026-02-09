# CLAUDE TASKS FEATURE KNOWLEDGE BASE

## OVERVIEW

Claude Code compatible task schema and storage. Provides core task management utilities used by task-related tools and features.

## STRUCTURE

```
claude-tasks/
├── types.ts               # Task schema (Zod)
├── types.test.ts          # Schema validation tests (8 tests)
├── storage.ts             # File operations
├── storage.test.ts        # Storage tests (30 tests, 543 lines)
├── session-storage.ts     # Session-scoped task storage
├── session-storage.test.ts
└── index.ts               # Barrel exports
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
}
```

**Key Differences from Legacy**:
- `subject` (was `title`)
- `blockedBy` (was `dependsOn`)
- `blocks` (new field)
- `activeForm` (new field)

## STORAGE UTILITIES

| Function | Purpose |
|----------|---------|
| `getTaskDir(config)` | Returns task storage directory path |
| `resolveTaskListId(config)` | Resolves task list ID (env → config → cwd basename) |
| `readJsonSafe(path, schema)` | Parse + validate, returns null on failure |
| `writeJsonAtomic(path, data)` | Atomic write via temp file + rename |
| `acquireLock(dirPath)` | File-based lock with 30s stale threshold |
| `generateTaskId()` | Generates `T-{uuid}` task ID |
| `listTaskFiles(config)` | Lists all task IDs in storage |
| `getSessionTaskDir(config, sessionID)` | Returns session-scoped task directory |
| `listSessionTaskFiles(config, sessionID)` | Lists tasks for specific session |
| `findTaskAcrossSessions(config, taskId)` | Locates task in any session directory |

## ANTI-PATTERNS

- Direct fs operations (use storage utilities)
- Skipping lock acquisition for writes
- Ignoring null returns from readJsonSafe
- Using old schema field names (title, dependsOn)
