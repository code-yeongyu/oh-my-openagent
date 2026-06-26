# QA Summary: Issue 77 Sparkshell Guidance

## What Was Tested
- RED: `npm run build --silent && npx vitest --run test/sparkshell-awareness.test.ts --no-file-parallelism` in `packages/omo-codex/plugin/components/rules`.
- GREEN focused rules: same command after the guidance update.
- GREEN adjacent prompt smoke: `npx vitest --run test/package-smoke.test.ts` in `packages/omo-codex/plugin/components/ultrawork`.
- Touched package validation:
  - Rules: `npm run typecheck && npm run build --silent && npx biome check src/sparkshell-awareness.ts test/sparkshell-awareness.test.ts`.
  - Ultrawork: `npm run build --silent && npx vitest --run test/package-smoke.test.ts && npm run typecheck && npx biome check agents/explorer.toml directive.md test/package-smoke.test.ts`.
  - Ulw-loop: `npm run typecheck && npm run build --silent`.
  - Prompts-core: `bun run --cwd packages/prompts-core typecheck && bun test packages/prompts-core/src/*.test.ts packages/prompts-core/test/*.test.ts`.
- Codex gate: `bun run test:codex`.
- Codex QA live surface: `bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin`.
- Manual QA: synthetic rules `SessionStart` hook invocation rendered `## Sparkshell Runtime` and asserted the positive `omo sparkshell rg --files` example plus the negative `not omo sparkshell 'rg --files'` warning.

## What Was Observed
- RED failed for the intended reason: runtime context did not contain `` `omo sparkshell rg --files` ``.
- GREEN rules and ultrawork tests passed with the new argv-token contract.
- Touched package validations passed, except markdown-specific Biome for ulw-loop was ignored by package config; the passing typecheck/build evidence is recorded separately.
- `bun run test:codex` passed with 404 Node test assertions and the Codex compatibility suite complete.
- `app-server-drive.sh --plugin` passed with `sessionStart` and `userPromptSubmit` hook completions and confirmed the real `~/.codex/config.toml` shasum was unchanged.
- Manual QA output includes `## Sparkshell Runtime`, `` `omo sparkshell rg --files` ``, ``not `omo sparkshell 'rg --files'` ``, `separate argv tokens`, and `one executable name`.

## Why It Is Enough
- The RED/GREEN test pins the exact ambiguity reported by `code-yeongyu/lazycodex#77` at the runtime context seam.
- The ultrawork smoke test covers the adjacent prompt guidance that repeats the Sparkshell-first rule.
- The live Codex app-server run proves the local plugin build is installed in an isolated `CODEX_HOME` and its hooks fire in a real Codex turn.
- Manual QA proves the final user-visible injected context contains both required examples.

## What Was Omitted
- Raw secret-bearing logs, environment dumps, tokens, auth headers, and private credentials were not copied.
- Full rules `npm run check` was not used as a passing gate because it fails on pre-existing package-wide Biome import/order and optional-chain findings unrelated to this change; `check-rules.txt` captures that residual.
