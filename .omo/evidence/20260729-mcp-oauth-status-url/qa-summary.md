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

## Requested review QA (2026-09-01)

### What was tested

- The status regression suite now creates a unique `mkdtempSync` configuration directory in every `beforeEach`, removes it in `afterEach`, and asserts the exact URL-keyed record plus access-token and refresh-token redaction.
- `bun test packages/omo-opencode/src/cli/mcp-oauth/status.test.ts packages/omo-opencode/src/cli/mcp-oauth/index.test.ts packages/omo-opencode/src/cli/mcp-oauth/logout.test.ts` completed with 16 passes and 0 failures.
- A source CLI run seeded a fixture token under a fresh `OPENCODE_CONFIG_DIR`, then ran `bun packages/omo-opencode/src/cli/index.ts mcp oauth status github --server-url https://oauth.example.test/mcp`.
- The CLI sandbox placed `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and `OPENCODE_CONFIG_DIR` under one unique temporary root. The harness rejected any path outside that root, restored the caller's prior environment values, removed the sandbox, and compared `SELECT count(*) AS session_count FROM session` against the real OpenCode database before and after.

### What was observed

- The source CLI exited 0 and printed the URL-keyed entry `oauth.example.test/https://oauth.example.test/mcp`.
- Access and refresh token output was `[REDACTED]`; checks confirmed neither fixture value appeared in captured output.
- OpenCode 1.18.25 reported a real session count of 0 before and 0 after. All isolation assertions passed and the temporary sandbox was removed.
- Captured CLI output: `review-followup-cli-output.txt`.
- XDG and real-database isolation proof: `review-followup-xdg-isolation.txt`.

### Why this is enough

The unit test pins the requested ownership seam: URL-key lookup, record labeling, and redacted display. The source CLI run covers Commander option parsing through the real status implementation and token store while the before/after database count proves the host OpenCode session database was not touched.

### What was omitted

Fixture token values were intentionally excluded from evidence. The QA harness kept them only in the temporary token store, asserted that captured output did not contain them, and deleted the sandbox. The host database path and unrelated environment values were not recorded.

### Remaining risk

Maintainer approval is still required before the fork's CI and Web CI workflows can run on the updated merge candidate.
