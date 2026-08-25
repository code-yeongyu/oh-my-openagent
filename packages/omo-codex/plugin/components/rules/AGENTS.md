# Repository Conventions

Conventions for human contributors and AI agents working on this repository.

## Style

- Terse technical prose. No emojis in commits, issues, PR comments, or code.
- TypeScript strict mode. No `any`, no `@ts-ignore`, no `@ts-expect-error`, no enums.
- ESM modules with `.js` suffix in runtime import paths.
- Tabs for indentation. Double quotes for strings.
- Tests use vitest with `#given .. #when .. #then` descriptions or plain `// given / // when / // then` body comments.

## Layout

- `src/cli.ts`: bin `omo-rules`; routes `hook session-start` / `hook user-prompt-submit` / `hook post-tool-use` / `hook post-compact`.
- `src/codex-hook.ts`: the four lifecycle hook functions (`runSessionStartHook`, `runUserPromptSubmitHook`, `runPostToolUseHook`, `runPostCompactHook`) — config, engine load, budgets, dedup, output formatting. Main behavioral hotspot.
- `src/persistent-cache.ts` + `src/session-state-lock.ts`: persisted static/dynamic dedup, target fingerprints, post-compact claims (`withPostCompactBudget`, `claimPostCompactPending`), `withSessionStateLock` (`SESSION_STATE_LOCK_CONTENDED`).
- `src/tool-paths.ts`: Codex file path extraction for reads, edits, `apply_patch`, shell-style tools (`extractCodexToolPaths`).
- `src/transcript-search.ts` / `src/transcript-rule-filter.ts`: transcript scanning and filtering.
- `src/rules-engine-factory.ts`: bridges `@oh-my-opencode/rules-engine` (discovery, parsing, matching, config).
- `bundled-rules/`: shipped Markdown rules (`hephaestus/`, `windows-git-bash.md`); ordering and platform candidates pinned by tests.
- `hooks/hooks.json`: registration. `scripts/bench-codex-rules.mjs`: benchmark.

## Commands

- `npm install` - install dependencies.
- `npm test` - run vitest once.
- `npm run typecheck` - strict TypeScript check.
- `npm run check` - type check, biome, and build.
- `npm pack --dry-run` - release package smoke test.
- `npm run bench` - builds then runs the rules benchmark (`node scripts/bench-codex-rules.mjs`).
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
