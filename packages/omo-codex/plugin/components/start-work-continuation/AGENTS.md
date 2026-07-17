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

- `src/boulder-reader.ts`: reads `.omo/boulder.json`, resolves the active work for the session, re-exports `getPlanChecklist`/`PlanChecklist` from `plan-checklist.ts`. `readContinuationState` returns null only when the plan has no readable top-level checklist (`total === 0`).
- `src/plan-checklist.ts`: `PlanChecklist` (`completed`/`remaining`/`total`/`nextTaskLabel`) and `getPlanChecklist`/`parsePlanChecklist`. Counts structured `## TODOs` rows (`N. <title>`) and `## Final Verification Wave` rows (`F<number>. <title>`); falls back to simple top-level `- [ ]`/`- [x]` checkboxes. Skips fenced blocks and respects `#`/`##` section boundaries.
- `src/codex-hook.ts`: Stop/SubagentStop hook; fills `REMAINING_COUNT`/`TOTAL_COUNT`/`NEXT_TASK_LABEL` from the checklist into `directive.md`.
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
- The hook continues while the plan has a readable top-level checklist (`total > 0`). A fully-checked plan still blocks Stop until the final gate runs and the Boulder work is marked completed; an unreadable or empty checklist yields no output.
