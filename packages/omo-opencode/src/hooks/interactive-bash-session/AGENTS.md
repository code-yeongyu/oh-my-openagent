# interactive-bash-session — Interactive Shell Session Hook

## OVERVIEW

Session-tier hook that tracks tmux sessions created through the `interactive_bash` tool. It observes `tool.execute.after`, records `new-session`/`kill-session`/`kill-server` effects, appends a session reminder, and kills tracked sessions on `session.deleted`. Requires tmux integration to be enabled.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook and event wiring | `hook.ts` |
| Session tracking | `interactive-bash-session-tracker.ts`, `state-manager.ts` |
| Tmux command parsing | `tmux-command-parser.ts`, `parser.ts` |
| Persistence and reminder copy | `storage.ts`, `constants.ts` |
| Public API and types | `index.ts`, `types.ts` |
| Public API | `index.ts` |

## CONVENTIONS

- Only `omo`-prefixed tmux sessions are tracked; other sessions are ignored by design.
- Skip bookkeeping when tool output starts with `Error:` so failed commands do not mutate tracked state.
- Resolve session identity through the shared event-session resolver and clear both in-memory and persisted state on delete.
- Session cleanup also aborts tracked subagent sessions from `features/claude-code-session-state`.
- Registration is conditional: the composer builds this hook only when tmux integration is enabled.
- Preserve the narrow barrel API; implementation helpers remain feature-local.

## ANTI-PATTERNS

- Do not treat ordinary non-interactive commands as interactive sessions.
- Do not bypass tracked-session cleanup when a pane or process exits.
- Do not construct unmanaged tmux processes in the hook; use the shared adapter boundary.
- Do not record state from a failed `interactive_bash` call; the error-prefixed output path returns early on purpose.
