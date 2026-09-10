# prometheus-md-only — Planner Write Policy

## OVERVIEW

Session-tier policy hook for Prometheus on `tool.execute.before`. It allows `.md` writes under `.omo`, throws on any other write/edit target, and prepends a planning-context warning to delegated `task` / `call_omo_agent` prompts.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook integration | `hook.ts` |
| Blocked tools, allowed extensions/prefix, reminder copy | `constants.ts` |
| Agent resolution and matching | `agent-resolution.ts`, `agent-matcher.ts` |
| Path policy | `path-policy.ts` |
| Public API | `index.ts` (re-exports constants and the factory) |

## CONVENTIONS

- Resolve the active agent before applying the policy; unrelated agents must pass through untouched.
- Denial is a thrown error, not a silent no-op, so the agent sees why the write was refused.
- Plan writes under `.omo/plans/` also append the workflow reminder to `output.message`.
- Delegation guarding covers `task` and `call_omo_agent`, and is skipped when the prompt already contains the planning-context marker.
- Blocked tools cover both capitalizations (`Write`/`write`, `Edit`/`edit`); the file path may arrive as `filePath`, `path`, or `file`.
- Keep the allowlist and blocked-tool policy in constants, and normalize separators before matching.

## ANTI-PATTERNS

- Prometheus must not modify non-markdown files, execute state-changing commands, or create/delete/rename files.
- Do not broaden the allowed path prefix or extension list in the hook implementation.
- Do not route a blocked change through a subagent; delegated implementation is still implementation.
- Do not bypass agent resolution to apply this policy globally.
