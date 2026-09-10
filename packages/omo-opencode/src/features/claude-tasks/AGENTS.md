# src/features/claude-tasks/ — Task Schema + Storage

**Generated:** 2026-05-15

## OVERVIEW

Four TypeScript files: `types.ts`, `storage.ts`, and their co-located tests. This module provides file-based task persistence with atomic writes, locking, and OpenCode todo API sync. There is no local `index.ts` barrel; consumers import the storage and schema modules directly.

## TASK SCHEMA

```typescript
interface Task {
  id: string              // T-{uuid} auto-generated
  subject: string         // Short title
  description?: string    // Detailed description
  status: "pending" | "in_progress" | "completed" | "deleted"
  activeForm?: string     // Current form/template
  blocks?: string[]       // Tasks this blocks
  blockedBy?: string[]    // Tasks blocking this
  owner?: string          // Agent/session
  metadata?: Record<string, unknown>
  repoURL?: string        // Associated repository
  parentID?: string       // Parent task ID
  threadID?: string       // Session ID (auto-recorded)
}
```

## FILES

| File | Purpose |
|------|---------|
| `types.ts` | Task interface + status types |
| `storage.ts` | `readJsonSafe()`, `writeJsonAtomic()`, `acquireLock()`, `generateTaskId()` |

## STORAGE

- Location: the OpenCode config directory's `tasks/<listId>` path by default; explicit configuration can override it. The list id precedence is `ULTRAWORK_TASK_LIST_ID`, `CLAUDE_CODE_TASK_LIST_ID`, configured id, then the current directory basename.
- Format: JSON files, one per task
- Atomic writes: temp file → rename
- Locking: file-based lock with a 30-second stale-lock threshold; release verifies lock identity
- Sync: Changes are pushed to the OpenCode Todo API after each update
