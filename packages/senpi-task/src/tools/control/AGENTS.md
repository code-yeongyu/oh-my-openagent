# control - Send and Cancel Tools

## OVERVIEW
Adapts task steering, cancellation, caller-session scope, wait bounds, and team shutdown messages into typed tool results.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Send routing | `send.ts`, `send-results.ts`, `send-shutdown.ts` | Plain task sends, team fallback, and structured shutdown messages. |
| Cancellation | `cancel.ts` | Manager cancellation and result details. |
| Scope/session | `caller-session.ts`, `clamp.ts` | Caller identity and bounded waits. |
| Rendering/contracts | `renderers.ts`, `tool-result.ts`, `types.ts` | Stable result details and presentation. |

## CONVENTIONS
- Tool inputs use snake_case while manager ports use camelCase; result details are discriminated by `kind`.
- Plain text first routes to a task, then to team mailbox routing when configured; structured messages are lead-only.
- Caller session scope is resolved from tool context and must be propagated to manager operations.
- Manager dependencies are narrow ports (`Pick`-style contracts), not concrete manager instances.

## ANTI-PATTERNS
- Never let a control tool mutate the record store directly.
- Never cross session scope without explicit `all_scope=true`.
- Never accept a shutdown rejection without a non-empty reason.
- Keep rendering separate from routing and preserve typed outcomes.

## HOTSPOTS
- `renderers.ts` (231 lines) is the largest module and shapes user-visible tool output.
- `send.ts` (153) contains the task-then-team routing decision and both tool factories.
- `send-shutdown.ts` (128) resolves default team ids and structured shutdown routing.

## QA
```sh
bun test packages/senpi-task/src/tools/control
```

Parent: [`../../AGENTS.md`](../../AGENTS.md).
