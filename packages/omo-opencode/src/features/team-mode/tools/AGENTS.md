# team-mode/tools — Team Tool Adapters

## OVERVIEW

Tool adapters translate validated OpenCode tool calls into team runtime, mailbox, status, and task operations. This 23-file domain owns schemas, dependency injection, participant resolution, delivery fallbacks, and lifecycle/task tool factories; orchestration stays in `../team-runtime/`.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Tool barrel and lifecycle grouping | `index.ts`, `lifecycle.ts` |
| Create/delete/shutdown tools | `lifecycle-create-tool.ts`, `lifecycle-shutdown-tools.ts` |
| Messaging tool and delivery | `messaging.ts`, `messaging-live-delivery*.ts`, `messaging-runtime.ts` |
| Mailbox wake fallback | `messaging-fallback-wake.ts` |
| Participant resolution | `lifecycle-participant.ts` (`resolveParticipant`, `findParticipantRuntime`) |
| Inline team specification | `lifecycle-inline-spec.ts` (`parseTeamCreateArgs`, `parseInlineTeamSpec`) |
| Team status/list queries | `query.ts` |
| Task tools | `tasks.ts` |

## CONVENTIONS

- Build `ToolDefinition` values through the local `tool(...)` helper and validate arguments with Zod schemas.
- Inject typed dependencies through `defaultDeps` objects so tests can exercise delivery and lifecycle failure paths deterministically.
- Resolve participants through runtime/registry helpers before delivery; `deliverLive` failures are logged because the message is already durably in the recipient inbox.
- Keep tool adapters thin: durable state transitions and rollback belong to team runtime/core modules.

## ANTI-PATTERNS

- Do not duplicate runtime lifecycle or durable state logic in a tool adapter.
- Do not skip argument parsing, participant authorization, or correlation/reference validation.
- Do not report a live delivery as successful when the fallback mailbox path was required.
