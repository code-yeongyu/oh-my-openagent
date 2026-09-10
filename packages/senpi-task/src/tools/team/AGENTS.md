# team tools - Lead Team Tool Facade

## OVERVIEW
Defines the six lead-only team tools for create/delete and tasklist operations, plus messaging and shutdown runners.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Team lifecycle | `lifecycle.ts` | Create/delete schemas, runners, and result details. |
| Team tasklist | `tasks.ts` | Create/get/list/update task operations. |
| Messaging | `messaging.ts` | Lead team send adapter. |
| Shutdown | `shutdown.ts` | Request, approve, and reject handshake runners. |
| Aggregate facade | `index.ts` | `buildLeadTeamTools` canonical six-tool list. |

## CONVENTIONS
- TypeBox schemas use snake_case external fields; service ports use camelCase and are injected.
- Tool results use structured `AgentToolResult` details keyed by operation kind.
- `buildLeadTeamTools` returns team create/delete plus four tasklist tools; messaging and shutdown are separate runners.
- Tests use fake services and colocated Bun tests rather than concrete runtime state.

## ANTI-PATTERNS
- Never expose this lead family to child/member sessions.
- Do not bypass the team service boundary with direct store writes.
- Do not treat messaging or shutdown helpers as additional aggregate tools without an explicit caller contract.

## HOTSPOTS
- `lifecycle.ts` (204 lines) and `tasks.ts` (186) hold nearly all behavior in this subtree.
- `index.ts` is the aggregation chokepoint; tool order there is the registered order.
- `classify-error.ts` maps mailbox/state failures into stable result kinds.

## QA
```sh
bun test packages/senpi-task/src/tools/team
```

Parent: [`../../AGENTS.md`](../../AGENTS.md).
