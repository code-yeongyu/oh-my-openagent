# Repository Conventions

Conventions for human contributors and AI agents working on this repository.

## Style

- Terse technical prose. No emojis in commits, issues, PR comments, or code.
- TypeScript strict mode. No `any`, no `@ts-ignore`, no `@ts-expect-error`, no enums.
- ESM modules with `.js` suffix in runtime import paths.
- Tabs for indentation. Double quotes for strings.
- Tests use vitest with `#given .. #when .. #then` descriptions or plain `// given / // when / // then` body comments.

## Commands

- `npm install` - install dependencies.
- `npm test` - run vitest once.
- `npm run typecheck` - strict TypeScript check.
- `npm run check` - type check, biome, and build.
- `npm pack --dry-run` - release package smoke test.
- `node dist/cli.js hook session-start < fixture.json` - smoke-test static rule injection.
- `node dist/cli.js hook post-tool-use < fixture.json` - smoke-test dynamic rule injection.

## Constraints

- No Bun APIs. Runtime is Node only because Codex launches plugin hooks with Node.
- Keep `SessionStart`, `UserPromptSubmit`, and `PostToolUse` hook behavior covered by tests.
- Keep Codex file path extraction for reads, edits, `apply_patch`, and shell-style tools covered by tests.
- Hook output must use the stable Codex hook JSON contract.
- Do not couple this package back to pi, omo, or senpi internal source paths.

## Don'ts

- No `git add -A` or `git add .`. Stage only the files you changed.
- No `git commit --no-verify`. No force pushes. No history rewriting on shared branches.
