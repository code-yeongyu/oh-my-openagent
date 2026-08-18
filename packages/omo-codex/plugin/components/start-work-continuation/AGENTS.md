# Repository Conventions

Conventions for human contributors and AI agents working on this repository.

## Stack

- Node >=20 runtime.
- npm package manager.
- TypeScript 6 strict mode.
- Biome 2 linting and formatting.
- Vitest 4 test runner.

## Forbidden

- No `as any` or `as unknown`.
- No `@ts-ignore` or `@ts-expect-error`.
- No enums.
- No non-null assertions.
- No default exports. `vitest.config.ts` is exempt because the framework requires that shape.

## File Ceiling

- Keep each `src/` TypeScript file under 250 pure LOC.
- Split by responsibility before a file reaches the ceiling.

## Test Discipline

- Use Vitest with nested `describe` names in `#given`, `#when`, and `#then` form, or inline `// given`, `// when`, and `// then` comments.
- Never use Arrange-Act-Assert comments.
- Keep fixtures in `test/fixtures/`.

## Layout

- `src/boulder-reader.ts`: reads `.omo/boulder.json`, resolves the active work for the session, re-exports `getPlanChecklist`/`PlanChecklist` from `plan-checklist.ts`. `readContinuationState` returns null in four cases: `boulder.json` is missing or unparseable, no work matches the session, the work status is not continuable (only `active` and `paused` continue - `completed`/`abandoned` stop), or `checklist.total === 0`.
- `src/plan-checklist.ts`: `PlanChecklist` (`completed`/`remaining`/`total`/`nextTaskLabel`) and `getPlanChecklist`/`parsePlanChecklist`. Counts structured `## TODOs` rows (`N. <title>`) and `## Final Verification Wave` rows (`F<number>. <title>`); falls back to simple top-level `- [ ]`/`- [x]` checkboxes. Skips fenced blocks and respects `#`/`##` section boundaries.
- `src/codex-hook.ts`: Stop/SubagentStop hook; fills nine placeholders into `directive.md` - `PLAN_NAME`, `PLAN_PATH`, `BOULDER_PATH`, `REMAINING_COUNT`, `TOTAL_COUNT`, `NEXT_TASK_LABEL`, `WORKTREE_BLOCK`, `LEDGER_PATH`, `SESSION_ID`. `WORKTREE_BLOCK` renders empty when the work has no worktree. When `remaining === 0`, `nextTaskLabel` is null and renders as "none (final gate pending)".
- **Context-pressure suppression:** the hook reads `input.transcript_path` through the injected `ReadonlyFileSystem` and returns `""` (no continuation) when the transcript carries any context-pressure marker (`context compacted`, `context_length_exceeded`, `context_too_large`, `codex ran out of room in the model's context window`, and related phrasings). This is the safety valve against an infinite continuation loop once the context window is exhausted; it is pinned by a `#given context-window pressure` test.
- `directive.md`: directive template with placeholders, applied per invocation.

## Build and Hooks

- Build output goes to `dist/`.
- `hooks/hooks.json` registers Codex `Stop` and `SubagentStop` hooks.
- Hook commands run `node ${PLUGIN_ROOT}/components/start-work-continuation/dist/cli.js hook stop` and `node ${PLUGIN_ROOT}/components/start-work-continuation/dist/cli.js hook subagent-stop`.

## Constraints

- Never let the hook block a Codex turn because of malformed input.
- Never make a network call from the hook.
- Keep the directive in `directive.md`. Do not inline it into TypeScript files.
- The hook only continues sessions listed in `.omo/boulder.json` as `codex:<session_id>`.
- The hook yields no output when `last_assistant_message` starts with `<start-work-blocked-external>`, or when that marker is the second line immediately after the mandatory `ULTRAWORK MODE ENABLED!` opener, so a conclusive external blocker can end the turn. Reject the marker everywhere else.
- The hook continues while the plan has a readable top-level checklist (`total > 0`). A fully-checked plan still blocks Stop until the final gate runs and the Boulder work is marked completed; an unreadable or empty checklist yields no output.
