# Repository Conventions

Conventions for human contributors and AI agents working on this component.

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
- `npm run build` - emit `dist/`.
- `node dist/cli.js hook session-start < fixture.json` - smoke-test the SessionStart hook.

## Constraints

- No Bun APIs. Runtime is Node only because Codex launches plugin hooks with Node.
- The single hook handler is `runSessionStartHook`. Do not add new hook handlers without also wiring them in `hooks/hooks.json` and `plugin/hooks/hooks.json`.
- Telemetry MUST be silent on every failure path. The CLI MUST exit 0 with empty stdout even when PostHog construction, capture, or shutdown throws.
- Telemetry MUST be daily-deduplicated. Adding a new event type requires a new state file slot, not removal of the existing dedup.
- Hook output MUST stay empty (no `additionalContext`, no `systemMessage`). This component is observability-only and MUST NOT inject context into the Codex conversation.
- Constants in `src/product-identity.ts` MUST stay byte-equivalent with `packages/omo-codex/src/telemetry/product-identity.ts`. The cross-package equivalence test will fail otherwise.
- Do not couple this component back to omo internal source paths beyond what `cross-package-equivalence.test.ts` already asserts at the constants layer.

## Don'ts

- No `git add -A` or `git add .`. Stage only the files you changed.
- No `git commit --no-verify`. No force pushes. No history rewriting on shared branches.
- No new network calls. PostHog is the only allowed sink.
- No new env vars without README + privacy-policy update.
