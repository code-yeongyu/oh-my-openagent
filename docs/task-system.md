# Task System

Oh My OpenCode's Task system provides structured task management with dependency tracking and parallel execution optimization.

## Note on Claude Code Alignment

This implementation follows Claude Code's internal Task tool signatures (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`) and field naming conventions (`subject`, `blockedBy`, `blocks`, etc.).

**However, Anthropic has not published official documentation for these tools.** The Task tools exist in Claude Code but are not documented on `docs.anthropic.com` or `code.claude.com`.

This is **Oh My OpenCode's own implementation** based on observed Claude Code behavior and internal specifications.

## Tools

| Tool | Purpose |
|------|---------|
| `TaskCreate` | Create a task with auto-generated ID (`T-{uuid}`) |
| `TaskGet` | Retrieve full task details by ID |
| `TaskList` | List active tasks with unresolved blockers |
| `TaskUpdate` | Update status, dependencies, or metadata |

## Task Schema

```ts
interface Task {
  id: string              // T-{uuid}
  subject: string         // Imperative: "Run tests"
  description: string
  status: "pending" | "in_progress" | "completed" | "deleted"
  activeForm?: string     // Present continuous: "Running tests"
  blocks: string[]        // Tasks this blocks
  blockedBy: string[]     // Tasks blocking this
  owner?: string          // Agent name
  metadata?: Record<string, unknown>
  threadID: string        // Session ID (auto-set)
}
```

## Dependencies and Parallel Execution

```
[Build Frontend]    ──┐
                      ├──→ [Integration Tests] ──→ [Deploy]
[Build Backend]     ──┘
```

- Tasks with empty `blockedBy` run in parallel
- Dependent tasks wait until blockers complete

## Example Workflow

```ts
TaskCreate({ subject: "Build frontend" })                    // T-001
TaskCreate({ subject: "Build backend" })                     // T-002
TaskCreate({ subject: "Run integration tests",
             blockedBy: ["T-001", "T-002"] })                 // T-003
```

```ts
TaskList()
// T-001 [pending] Build frontend        blockedBy: []
// T-002 [pending] Build backend         blockedBy: []
// T-003 [pending] Integration tests     blockedBy: [T-001, T-002]
```

```ts
TaskUpdate({ id: "T-001", status: "completed" })
TaskUpdate({ id: "T-002", status: "completed" })
// T-003 now unblocked
```

## Storage

Tasks are stored as JSON files:

```
.sisyphus/tasks/
```

## Difference from TodoWrite

| Feature | TodoWrite | Task System |
|---------|-----------|-------------|
| Storage | Session memory | File system |
| Persistence | Lost on close | Survives restart |
| Dependencies | None | Full support (`blockedBy`) |
| Parallel execution | Manual | Automatic optimization |

## When to Use

Use Tasks when:
- Work has multiple steps with dependencies
- Multiple subagents will collaborate
- Progress should persist across sessions
