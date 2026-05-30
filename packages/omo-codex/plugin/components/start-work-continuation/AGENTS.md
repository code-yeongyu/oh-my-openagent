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

## Build and Hooks

- Build output goes to `dist/`.
- `hooks/hooks.json` registers Codex `Stop` and `SubagentStop` hooks.
- Hook commands run `node ${PLUGIN_ROOT}/components/start-work-continuation/dist/cli.js hook stop` and `node ${PLUGIN_ROOT}/components/start-work-continuation/dist/cli.js hook subagent-stop`.

## Constraints

- Never let the hook block a Codex turn because of malformed input.
- Never make a network call from the hook.
- Keep the directive in `directive.md`. Do not inline it into TypeScript files.
- The hook only continues sessions listed in `.omo/boulder.json` as `codex:<session_id>`.
