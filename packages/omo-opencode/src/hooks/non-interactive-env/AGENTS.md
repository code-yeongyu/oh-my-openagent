# non-interactive-env — Shell Environment Guard

## OVERVIEW

Session-tier hook on `tool.execute.before` for the `bash` tool. It warns when a command matches a known interactive program and prepends the non-interactive environment prefix to git commands so editors and pagers cannot block.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook behavior | `non-interactive-env-hook.ts` |
| Environment/banned-command constants | `constants.ts` |
| Environment detection helpers | `detector.ts` (`isNonInteractive`) |
| Public API and types | `index.ts`, `types.ts` |

`index.ts` re-exports constants, detector, and types alongside the factory, so callers can reuse the environment table without importing the hook.

## CONVENTIONS

- Prefix syntax follows the detected shell; on Windows the hook maps cmd/PowerShell explicitly rather than trusting a Unix-shaped `SHELL`.
- The git prefix is applied regardless of TTY state, because the agent cannot answer prompts from spawned processes.
- Rewriting is idempotent: a command already starting with the prefix is left alone.
- Keep required environment variables in exported constants so policy changes are reviewable.
- Banned interactive commands set `output.message` as a warning; they are not blocked.
- The hook returns a single `tool.execute.before` handler and holds no session state.
- Tests use Bun and cover shell variants through the public barrel.

## ANTI-PATTERNS

- Required non-interactive variables must always be injected for git commands; bypassing the prefix defeats the hook.
- Do not gate the git prefix behind `isNonInteractive()`; that check was deliberately removed.
- Do not rewrite non-bash tools or non-git commands.
