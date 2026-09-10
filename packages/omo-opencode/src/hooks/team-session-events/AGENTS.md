# team-session-events — Direct Team Event Handlers

## OVERVIEW

This 11-file directory contains event-specific team handlers wired directly by `src/plugin/event.ts`, not by a tier composer. It handles idle wake hints, lead orphaning, member errors, and member status transitions.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Idle wake and mailbox acknowledgements | `team-idle-wake-hint.ts` |
| Lead departure/orphaning | `team-lead-orphan-handler.ts` |
| Member error handling | `team-member-error-handler.ts` |
| Status transitions | `team-member-status-handler.ts` |
| Colocated behavior tests | matching `*.test.ts` files |

Each file exports one `create*` factory returning a single event handler, so `src/plugin/event.ts` can register them individually.

## CONVENTIONS

- Normalize session IDs through the shared event resolver; event payload spellings are not assumed to be uniform.
- Use registry/runtime lookup before changing team state, and guard transitions by current status and role.
- Wake hints must account for pending acknowledgements, requeue undelivered messages, and suppress duplicates.
- Status transitions are guarded by source status: `session.idle` moves only `running` to `idle`, while `session.deleted` moves `running`/`idle`/`pending` to `completed`.
- Handler failures are logged and swallowed so one bad event cannot break the plugin event loop.
- Keep handlers independently testable; this directory intentionally has no public barrel.

## ANTI-PATTERNS

- Do not wire these handlers through a generic hook tier without preserving their direct event ordering.
- Do not transition members based on stale or unverified session identity.
- Do not emit duplicate wake hints or silently discard undelivered mailbox messages.
