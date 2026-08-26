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

## Commit Style

- Use Conventional Commits.
- Keep commits atomic.
- Each commit's tests and build must pass on its own.

## Branding

- Repo artifacts live under `.omo/ulw-loop/` paths.
- Environment variables use the `OMO_ULW_LOOP_*` prefix.
- CLI commands use the `omo-agent-toolkit ulw-loop` form.
- Do not use any alternate legacy CLI alias anywhere.

## Layout

- `src/cli.ts`: bin entry (`omo-ulw-loop`, `ulw`, `ulw-loop` all map to `dist/cli.js`); documented invocation form `omo-agent-toolkit ulw-loop <subcommand>`.
- `src/cli-commands.ts`: subcommand dispatch (`ULW_LOOP_SUBCOMMANDS`, `ulwLoopCommand`, flag/value readers).
- `src/plan-io.ts`: plan persistence, append-only `ledger.jsonl`, `withUlwLoopMutationLock`.
- `src/quality-gate.ts` (266 LOC), `src/checkpoint.ts` (260), `src/steering.ts` (227): state-transition hotspots (evidence containment, checkpoint reconciliation, steering mutations).
- `src/codex-hook.ts`: UserPromptSubmit steering injection + `create_goal` budget guard.
- `src/spawn-guard.ts`, `src/stop-resume-hook.ts`: spawn guards, Stop auto-resume.
- `src/ultrawork-skill-pointer.ts`: byte-identical mirror of ultrawork's pointer (pinned by `plugin/test/ultrawork-skill-pointer.test.mjs`).
- `directive.md`: runtime-read directive (never inlined into TypeScript).

## Build and Hooks

- Build output goes to `dist/`.
- `hooks/hooks.json` wires `hook user-prompt-submit --with-ultrawork` (UserPromptSubmit), `hook pre-tool-use` (create_goal budget), `hook pre-tool-use-spawn` (spawn guards), and `hook stop` (auto-resume).

## Commands

- `npm test` (vitest --run) / `npm run test:watch`; focused: `bunx vitest run test/<file>.test.ts`
- `npm run typecheck` / `npm run lint` / `npm run build` (`tsc -p tsconfig.build.json`) / `npm run check`
