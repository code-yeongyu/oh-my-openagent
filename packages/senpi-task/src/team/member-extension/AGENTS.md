# member-extension - In-Child Team Runtime

## OVERVIEW
Bootstraps the process member extension, validates identity/environment, polls its durable inbox, and exposes scoped team messaging.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Extension entry | `index.ts` | Environment parsing, startup, timers, and registration. |
| Identity | `identity.ts` | Environment names and member-process detection. |
| Polling | `self-poller.ts`, `session-scan.ts` | Inbox observation and recipient-session state. |
| Scoped tool | `tools.ts` | Member-only `task_send` construction. |
| QA hook | `qa-inject-hold.ts` | Controlled injection hold used by tests. |

## CONVENTIONS
- Identity is `<teamRunId>::<memberName>` with a UUID run id and lowercase kebab-case member name.
- Extension configuration is validated fail-closed into typed `MemberExtensionConfigError` codes.
- Polling intervals are timer-driven in the child process; durable store reads provide message state.
- The member tool receives only team-scoped routing dependencies, never the lead tool family.

## ANTI-PATTERNS
- Never accept an invalid member identity or task id by coercion.
- Do not expose lead lifecycle/tasklist tools from the member extension.
- Do not bypass durable mailbox acknowledgement when injecting a message.

## HOTSPOTS
- `index.ts` (221 lines) is the bootstrap and timer owner for the in-child runtime.
- `self-poller.ts` (199) implements inbox observation and acknowledgement.
- Active runtimes are tracked per extension instance, so repeated activation must not double-register timers.

## QA
```sh
bun test packages/senpi-task/src/team/member-extension
```

Parent: [`../AGENTS.md`](../AGENTS.md).
