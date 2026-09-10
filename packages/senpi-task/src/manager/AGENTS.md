# manager - Task Orchestration

## OVERVIEW
The manager plans and starts children, owns concurrency and live handles, persists outcomes, and reconnects or respawns durable tasks.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Main orchestration | `manager.ts` | Closure-backed state, start/queue, handles, waiters, outcomes, and cleanup. |
| Launch and revival | `manager-respawn.ts`, `runner.ts`, `child-handle.ts` | Trusted launch inputs and execution-mode adapters. |
| Capacity | `concurrency.ts`, `spill-admission.ts` | Lane precedence, global permits, FIFO queue, and spill behavior. |
| Policy and identity | `depth-policy.ts`, `execution-mode.ts`, `names.ts` | Depth limits, mode choice, canonical names. |
| Resume context | `parent-registry-context.ts`, `interrupted-turn.ts` | Live model lookup and continuation detection. |

## CONVENTIONS
- `TaskManagerImpl` is private; consumers use the `TaskManager` interface returned by `createTaskManager`.
- Durable fields use snake_case while in-memory launch/spec fields use camelCase.
- Capacity leases are keyed by task and run epoch; `0` means unlimited and the default limit is 5.
- Respawn rebuilds only persisted v1 safe facts; executable tools, extensions, and member environment come from trusted live resolution.
- Intentional large/stateful code uses the existing `SIZE_OK` marker rather than decomposition for its own sake.

## ANTI-PATTERNS
- Never release capacity without matching task/run-epoch identity.
- Never resume from stale persisted executable registries or human display-model strings.
- Do not resurrect terminal records while folding pid/session facts.
- Keep ownership cleanup idempotent: stale handles, waiters, and empty queue keys must be removed.

## HOTSPOTS
- `manager.ts` (1009 lines) is the dominant complexity concentration and the first file to read for start/settle behavior.
- `manager-respawn.ts` (267) classifies respawn failures and rebuilds trusted launch inputs.
- `concurrency.ts` (208) owns lane precedence, permits, leases, and dispatch order.

## QA
```sh
bun test packages/senpi-task/src/manager
```

Parent: [`../AGENTS.md`](../AGENTS.md).
