# CodeGraph SessionStart hardening QA

## What was tested

1. Built the repository with `bun run build`.
2. Ran the canonical Codex gate with `bun run test:codex`.
3. From `packages/omo-codex/plugin/components/codegraph`, rebuilt the committed runtime with `bun run build`, ran `bun test ./test`, and ran `../../node_modules/.bin/tsc --noEmit`.
4. Ran `.agents/skills/codex-qa/scripts/app-server-drive.sh --plugin` against an isolated `CODEX_HOME` and the local mock model.
5. Ran `.agents/skills/codex-qa/scripts/install-verify.sh --self-test` to prove the local plugin landed only in the isolated Codex home.
6. Ran `fixture-session-start.sh`, which installs the local plugin into an isolated `CODEX_HOME`, creates an allowed fixture shaped like `omo-desktop-app/apps/server`, places an exact `.codegraph/codegraph.db` in that fixture, and invokes the installed CodeGraph SessionStart hook. A sentinel `OMO_CODEGRAPH_BIN` records any CLI invocation, while the script checks worker processes, lock files, hook stdout, and `session-start.jsonl` size before and after.

## What was observed

- Root build completed successfully: `root-build.txt`.
- `bun run test:codex` passed all active suites: 95 LSP MCP tests, 420 ulw-loop tests, 76 CodeGraph component tests, 389 root Bun tests, and 514 Node installer/plugin tests. Total: 1,494 passed and 1 skipped: `test-codex.txt`.
- The final component build regenerated `dist/cli.js` and `dist/serve.js`: `component-build.txt`.
- The final component suite passed 76/76 tests with 243 assertions: `component-test.txt`.
- Component TypeScript checking exited zero with no diagnostics: `component-tsc.txt`.
- Live Codex app-server completed a mock-model turn and emitted first-party `hook/started` and `hook/completed` notifications for the CodeGraph-bearing `sessionStart` event, plus `userPromptSubmit`: `app-server-drive.json` and `app-server-drive.stderr.txt`.
- The local isolated install contained the plugin cache, enabled `omo@sisyphuslabs`, linked nine component bins and agent TOMLs, and left the real `~/.codex/config.toml` unchanged: `install-verify.txt`.
- The storm-shaped fixture produced zero hook stdout bytes, zero CodeGraph CLI invocations, zero worker PIDs, zero lock files, and no `session-start.jsonl` growth (0 bytes before and after). The real Codex config checksum was unchanged: `fixture-session-start.json` and `fixture-session-start.stderr.txt`.

## Why this is enough

The component tests cover exact-directory initialization, timeout/inconclusive fail-closed behavior, atomic lock deduplication, stale-lock recovery, cooldown expiry and exponential backoff, nested-root suppression, direct `init` without `status`, and timeout-to-cooldown behavior. The installed-fixture probe exercises the built artifact rather than TypeScript source and directly checks the regression signature: no status CLI, no worker, no lock, and no outcome-log growth for an already initialized project. The app-server artifact separately proves Codex still wires and completes the SessionStart hook in a real isolated turn.

## Post-rebase verification

After rebasing onto `dev` with the CodeGraph 1.5.0 managed-runtime changes, the component build succeeded, all 78 component tests passed with 249 assertions, and `tsc --noEmit` completed without diagnostics. The four utils suites touching OMO config passed 22/22 tests, the Codex config-loader suite passed 10/10 tests, and the regenerated omo-senpi extension passed `build-extension.mjs --check` with the reported state `current`. This specifically verifies that version-aware managed-runtime re-provisioning remains intact alongside the no-status SessionStart bootstrap guards.

## What was omitted

- No TUI smoke was run because this change has no visual or interactive behavior; the app-server notification stream is the assertion-grade lifecycle surface.
- Raw installer build logs, environment dumps, credentials, tokens, and auth headers were not copied into evidence. The captured files contain only sanitized command output and temporary sandbox paths.
