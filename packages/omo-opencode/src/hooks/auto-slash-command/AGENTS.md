# auto-slash-command — Command Detection Hook

## OVERVIEW

Skill-tier hook that detects slash commands and replaces the message with the resolved command template. It handles both `chat.message` and `command.execute.before`, deduplicates repeated executions, and clears state on `session.deleted`.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook factory | `hook.ts` |
| Command matching | `detector.ts` |
| Execution bridge | `executor.ts` |
| Execution deduplication | `processed-command-store.ts` |
| Tag constants and types | `constants.ts`, `types.ts` |
| Public API | `index.ts` |
| Leak regression suite | `leak/auto-slash-command-leak.test.ts` |

## CONVENTIONS

- Injected templates are wrapped in the auto-slash-command tags; messages already carrying those tags are skipped to prevent re-entry.
- Deduplicate by session plus message/event ID, with a short TTL fallback key when no event ID is available.
- Preserve the distinction between detecting a command and executing it; unresolved commands leave the message untouched.
- On `command.execute.before`, insert the template at the detected part index or unshift it when no slash part exists.
- Clear both processed-command stores on `session.deleted` and in `dispose`.
- Tests are colocated Bun tests, including a leak suite under `leak/`.

## ANTI-PATTERNS

- Do not execute arbitrary chat text as a command.
- Do not bypass the hook's command detector when adding a command route.
- Do not put command-specific side effects in the detector.
