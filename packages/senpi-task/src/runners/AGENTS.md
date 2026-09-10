# runners - Child Execution Modes

## OVERVIEW
Provides in-process and RPC child execution with shared types, handles, protocol boundaries, and typed failure mapping.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| In-process execution | `in-process.ts`, `in-process/` | Parent tool closures, child sessions, curated read-only shell, and handle outcomes. |
| RPC execution | `rpc-process.ts`, `rpc/` | Spawn admission, JSON-RPC protocol, process termination, and transcript outcomes. |
| Shared contracts | `types.ts`, `index.ts` | Runner options, child specs, handles, and public exports. |
| Fixtures | `__fixtures__/` | Process/session helpers used only by tests. |

## CONVENTIONS
- Execution mode is explicit (`in-process` or `process`) and resolved by manager policy; team members always use process mode.
- Child sessions persist under the task state directory, allowing clean shutdown and crash recovery to share evidence.
- Runtime Senpi/pi-tui imports stay behind lazy adapters; type-only imports are erased.
- RPC input is serialized plain data. Protocol malformed lines are reported/skipped, while process signaling remains a separate concern.

## ANTI-PATTERNS
- Never fall back to an in-memory/default session directory or widen a restored child's tool surface.
- Never use `shell: true` for RPC spawning.
- Never treat missing assistant output as successful completion.
- Runner handle definitions may delegate teardown, but lifecycle code alone triggers destruction.

## HOTSPOTS
- `in-process.ts` (273 lines) covers session start/resume and typed failure translation.
- `in-process/child-handle.ts` concentrates turn lifecycle and outcome derivation.
- `rpc/` holds the process boundary; see [`rpc/AGENTS.md`](rpc/AGENTS.md).

## QA
```sh
bun test packages/senpi-task/src/runners
```

Parent: [`../AGENTS.md`](../AGENTS.md).
