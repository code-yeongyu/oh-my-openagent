# steering - Child Messaging and Control

## OVERVIEW
Routes sends, interrupts, and cancellation to live, resident, detached, or prelaunch children with durable queueing.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Core routing | `engine.ts` | Task lookup, scope, messageability, send arbitration, and outcome mapping. |
| Policy | `engine-policy.ts` | One-shot, scope, and delivery-uncertainty decisions. |
| Revival | `revive.ts` | Terminal detached RPC revival and new run epoch handling. |
| Contracts | `types.ts`, `index.ts` | Ports, inputs, outcomes, and public facade. |

## CONVENTIONS
- Sends to prelaunch records append ordered `pending_steering` entries and are drained by the runner.
- Live sends use per-task arbitration so eviction cannot race a message already in flight.
- Cross-session sends require `all_scope`; absent caller identity is not treated as global access.
- Terminal detached RPC records with usable transcripts may revive lazily; suspended records resume with their session.

## ANTI-PATTERNS
- Never call `dispose`, `terminate`, or process signaling from steering; destruction belongs to lifecycle.
- Never resend automatically after delivery uncertainty; inspect output first.
- Never let a one-shot agent accept `task_send`.
- Transition cancellation/interrupt before aborting, and preserve resident cleanup when abort rejects.

## HOTSPOTS
- `engine.ts` (315 lines) branches across resolution, policy, queueing, revival, and destruction handoff.
- `revive.ts` (167) rebuilds a fresh run epoch and clears prior-run terminal fields.
- Send bookkeeping is epoch-scoped; per-epoch counting is what keeps new-run messages off a prior run.

## QA
```sh
bun test packages/senpi-task/src/steering
```

Parent: [`../AGENTS.md`](../AGENTS.md).
