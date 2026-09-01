# PR 6611 Windows Codex CI stabilization

## What was tested

1. Reproduced the failing GitHub job locally with:
   `bun run test:codex`
2. Ran the exact failing package after isolating its tests:
   `npm --prefix packages/lsp-tools-mcp test`
3. Ran package static gates:
   `npm --prefix packages/lsp-tools-mcp run typecheck`
   `npx biome check test/process.test.ts test/mcp.test.ts test/client-wrapper.test.ts`
4. Drove a real Codex app-server turn using the local plugin, an isolated
   `CODEX_HOME`, and the codex-qa local mock model.
5. Verified the codex-qa temporary home was removed.

## What was observed

### Before

GitHub run `31760176754`, job `94644705178`, failed only
`codex-compatibility (windows-latest)`.

The failure reproduced locally:

- two `createSpawnCommand` expectations inherited the host's globally
  installed `typescript-language-server.CMD` through `PATH`;
- MCP `status` requests inherited real cwd/home configuration and crossed
  Vitest's five-second timeout under concurrent load;
- the first full gate stopped with 93 passing, 1 skipped, and 3 failing LSP
  package tests.

The affected files were byte-identical to `upstream/dev` before this patch, so
the failure was a pre-existing host-dependent test defect rather than a
runtime-fallback production regression.

### After

The LSP package is deterministic:

- 25 test files passed;
- 96 tests passed, 1 skipped, 0 failed;
- package `tsc --noEmit` passed;
- Biome passed on all three changed test files.

The isolated live Codex run observed:

- assistant text: `Hello from the codex-qa mock model.`;
- completed plugin hooks: `sessionStart`, `userPromptSubmit`, and `stop`;
- the codex-qa assertion that real `~/.codex/config.toml` was unchanged passed;
- isolated home: `/tmp/cqa-home.TU2Z02/codex`;
- `sandbox_removed=true`.

The second full local `bun run test:codex` passed the formerly failing LSP
stage and reached later installer tests. On this OneDrive Windows workspace,
21 later installer tests timed out after 1244 seconds. Those timeouts were not
the GitHub failure being fixed and are not reported as a clean full local
gate. The replacement GitHub Windows job is the authoritative full-gate
verification.

## Why it is enough

The patch changes tests only. It removes the two environmental inputs that
caused the Windows job to fail: ambient executable lookup and ambient
cwd/home configuration. The exact package now passes completely, its static
gates pass, and the real Codex plugin still installs into an isolated home,
completes an app-server turn, and fires first-party hooks.

## What was omitted

Raw npm install logs, environment dumps, and full app-server notification
streams were not copied because they can contain machine-local paths and
environment details. Two failed QA-launch attempts were summarized instead:
WSL could not chmod npm shims on the Windows mount, and the first native stream
wrapper did not resolve the Codex `.cmd` shim. Neither attempt reached a
product assertion.
