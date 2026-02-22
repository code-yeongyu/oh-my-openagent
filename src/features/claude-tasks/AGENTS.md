# src/features/claude-tasks/ — Task Schema + Storage

**Generated:** 2026-02-17

## OVERVIEW

4 non-test files (~622 LOC). File-based task persistence with atomic writes, locking, and OpenCode todo API sync.

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
| `session-storage.ts` | Per-session task storage, threadID auto-recording |
| `index.ts` | Barrel exports |

## STORAGE

- Location: `.sisyphus/tasks/` directory
- Format: JSON files, one per task
- Atomic writes: temp file → rename
- Locking: file-based lock for concurrent access
- Sync: Changes pushed to OpenCode Todo API after each update
