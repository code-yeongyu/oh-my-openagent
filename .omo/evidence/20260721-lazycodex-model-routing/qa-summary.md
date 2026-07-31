# LazyCodex model routing QA

## What was tested

- `node --test packages/omo-codex/plugin/test/aggregate-agents.test.mjs`
  - Verified each of the six bundled ultrawork agent TOMLs has its requested
    model and reasoning effort.
- `bun run --cwd packages/omo-codex typecheck`, `bun run typecheck`, and
  `bun run build`
  - Verified TypeScript diagnostics and the distributable installer bundle.
- `bun run test:codex`
  - Ran the Codex compatibility gate after the migration-default change.
- `REPO_ROOT=<worktree> bash .../codex-qa/scripts/install-verify.sh --self-test`
  - Drove the real installer into a temporary isolated `CODEX_HOME`.
- `REPO_ROOT=<worktree> bash .../codex-qa/scripts/app-server-drive.sh --plugin`
  - Drove a real isolated `codex app-server` session against the local mock
    model and asserted plugin hook notifications.

## What was observed

- Aggregate routing test: 6 passing assertions.
- Managed migration tests: 13 passing assertions, including every requested
  legacy managed-route upgrade and preservation of user-customized values.
- Package and repository typechecks passed; the build passed.
- `bun run test:codex` passed: 510 Node tests and 382 Bun tests, with one
  expected platform-specific skip.
- The isolated installer found the plugin cache, enabled `omo@sisyphuslabs`,
  linked nine component bins and agent TOMLs, and reported the real
  `~/.codex/config.toml` checksum unchanged:
  `e1213327752215e76048d840b74aa0cecf3504d7`.
- The isolated app-server session completed a mock-backed turn and observed
  `sessionStart`, `userPromptSubmit`, and `stop` hooks complete. It also
  reported the same unchanged real-config checksum.

## Why this is enough

The aggregate contract proves the bundled role settings. The migration tests
prove existing installations receive the revised defaults only when their
configuration still matches a known managed value. The compatibility gate,
isolated install, and real app-server session cover the shipped installer and
live Codex plugin surface without using the real Codex home.

## What was omitted

Raw QA logs were not committed because they may contain temporary home paths
and verbose runtime output. No credentials, tokens, auth headers, or
environment dumps were captured.
