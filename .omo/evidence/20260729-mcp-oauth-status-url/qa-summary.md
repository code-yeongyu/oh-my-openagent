# MCP OAuth status URL QA

## Scope

`mcp oauth status` now accepts `--server-url` and queries the same URL-keyed token storage that `login` and `logout` use. This is a CLI-only path; it does not start an OpenCode session or call a model provider.

## Automated checks

- `bun test packages/omo-opencode/src/cli/mcp-oauth/status.test.ts packages/omo-opencode/src/cli/mcp-oauth/index.test.ts packages/omo-opencode/src/cli/mcp-oauth/logout.test.ts` - 16 passed, 0 failed.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` - passed.
- `git diff --check` - passed.
- `bun run typecheck` - passed.
- `OMO_SKIP_MATERIALIZE=1 bun run build` - passed. The supported skip avoids fetching unrelated vendored submodules; all build stages completed.

The new regression test writes a token only to a temporary `OPENCODE_CONFIG_DIR`, invokes status with the display name and URL, and asserts that the URL-keyed token is found. Its output redacts token values.

The full `bun test` run completed 12,411 passing tests, 3 skips, and 4 unrelated failures: a vendored-submodule provenance gate, a Codex installer fixture that expects the unavailable designpowers vendor files, a simulated Windows Git Bash installation timeout, and an npm registry timeout in the auto-update checker. The focused OAuth tests and the package typecheck pass independently.

## CLI smoke

Both commands used a fresh temporary `OPENCODE_CONFIG_DIR`; no user token store or provider credential was read or written.

- `bun packages/omo-opencode/src/cli/index.ts mcp oauth status github --server-url https://oauth.example.test/mcp` printed `No tokens found for github` and exited 0.
- After saving a fixture token at `https://oauth.example.test/mcp` in that temporary store, the same command printed `OAuth Status for github:`, the URL-keyed entry, and `Access Token: [REDACTED]`; it exited 0.

## OpenCode QA routing

The repository's `opencode-qa` routing was used to scope this as a CLI command. The host did not have `opencode`; a temporary `bunx opencode-ai` install supplied version 1.18.9 without changing project dependencies. Docker QA was unavailable because its daemon was not running. A live OpenCode turn is not relevant to this command: OAuth status reads the configured token store only and never loads a plugin session.

## Residual risk

The command still requires `--server-url` when the display name differs from the token URL, matching the existing logout contract. The change does not alter OAuth discovery, token storage, token contents, or authentication.

## Review follow-up (2026-08-29)

The Commander action now types its options parameter as `StatusOptions`; runtime behavior is unchanged.

- `bun test packages/omo-opencode/src/cli/mcp-oauth/status.test.ts packages/omo-opencode/src/cli/mcp-oauth/index.test.ts packages/omo-opencode/src/cli/mcp-oauth/logout.test.ts` — 16 passed, 0 failed.
- `bun run typecheck` — passed across the root, scripts, and workspace packages.
- `git diff --check` — passed.
- A direct CLI smoke used fresh `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and `OPENCODE_CONFIG_DIR` directories. `bun packages/omo-opencode/src/cli/index.ts mcp oauth status github --server-url https://oauth.example.test/mcp` printed `No tokens found for github` and exited 0 without reading the host token store.
