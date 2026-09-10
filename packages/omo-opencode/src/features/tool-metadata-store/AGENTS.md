# tool-metadata-store — Pending Tool Metadata

## OVERVIEW

This 12-file feature stores and publishes structured metadata that links tool calls to background tasks and sessions. It is an in-memory, one-time-consumption boundary used by task/session integrations.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Pending store lifecycle | `store.ts` |
| Canonical call-ID resolution | `resolve-tool-call-id.ts` |
| Structured metadata format | `task-metadata-contract.ts` |
| Publish and recovery adapters | `publish-tool-metadata.ts`, `recover-tool-metadata.ts` |
| Public exports | `index.ts` |

## CONVENTIONS

- The store exists because OpenCode's `fromPlugin()` wrapper replaces tool metadata; `tool.execute.after` merges the stored entry back.
- Normalize accepted call-ID and session-ID spellings before storing or matching metadata; entries older than 15 minutes are swept on write.
- Consume entries once with `consumeToolMetadata`; exact session/call matches take precedence.
- Structured output uses a literal `<task_metadata>` block with snake_case keys and fixed field order.
- Cross-session fallback is allowed only when a call ID identifies one unambiguous pending entry; blank or ambiguous IDs are not stored.
- Keep publisher and recovery dependencies injectable for deterministic Bun tests.

## ANTI-PATTERNS

- Do not retain consumed metadata or treat the pending store as durable persistence.
- Do not guess across ambiguous call-ID collisions.
- Do not change metadata field order or aliases without updating the contract parser and consumers.
