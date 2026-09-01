# QA Summary - #6131 follow-up: version-current pull-cache guard in the silent-server fallback

Date: 2026-07-19. Host: macOS arm64 (M5 Max), bun. Worktree: omo-wt/fix-6131 (PR #6140 branch + origin/dev merged).

## Scope of THIS increment

PR #6140's terminal fallback returned `getStoredDiagnostics(uri)`. Two defects in that choice:

1. **Stale pull cache (Linux/Windows):** `getStoredDiagnostics(uri)` returns `lastPublish ?? pullCache ?? []` with no version check. `changeDocument` does not clear `pullCache` (workspace-document-state.ts), so after a document change the fallback could return the PREVIOUS version's pull diagnostics as if current (codex-review P2 on #6140).
2. **Current cache invisible (macOS):** `diagnostics()` builds `uri` from `resolveWorkspacePath` (plain `resolve`, no realpath) while `WorkspaceDocumentState` keys documents by `realpathSync` path. On macOS `/var/folders` -> `/private/var/folders`, so `getStoredDiagnostics(uri)` missed even a version-current cache and always returned `[]`.

Fix: the terminal fallback now uses the snapshot-keyed, version-filtered `documents.getPullCache(snapshot)` - an actually-current cache is returned, anything else resolves explicit empty. `publishGeneration === 0` guarantees no publish exists, so push state cannot leak in.

## RED -> GREEN (unit seam)

- `red-stale-cache.txt` - fix stashed (PR head + merge only): the "current cached pull report" test FAILS (expected [cached-full], got [] via the macOS uri mismatch; on Linux the stale-cache test fails instead). exit=1.
- `green.txt` - fix restored: all 12 freshness integration tests pass. exit=0.

## Live surface (real marksman, production MCP stdio)

- `live-before-fix.txt` - origin/dev: real marksman via `bun packages/lsp-tools-mcp/src/cli.ts mcp` on a clean README.md -> "Timed out waiting for fresh diagnostics ... within 3000ms", isError: true, errorKind: freshness_timeout. Same symptom as issue #6131 and the Discord report (lazycodex "timed out after 3000ms").
- `live-after-fix.txt` - fixed branch: same drive -> "No diagnostics found", isError: false; elapsed 3485ms shows the full 3000ms freshness window is still honored before resolving clean (a slow publisher can still win).
- `live-mcp-driver.mts` - the driver script (workspace + user config isolated in mktemp dirs; nothing touches the real ~/.codex or opencode DB).

## Contract + regression

- `probe-after-fix.json` - diagnostics-freshness-contract-probe: all 9 outcomes ok (stale/future publish still freshness_timeout; pull-overtaken retry; unsupported-pull -> push fallback; unchanged-cache reuse; silent -> clean under the restored pre-migration contract).
- lsp-core suite: 92 pass / 0 fail.
- `typecheck.txt` exit=0. `build.txt` exit=0. `test-codex.txt` exit=0 (510 pass: lsp-tools-mcp + lsp-daemon + omo-codex plugin gate - covers the Codex/lazycodex edition path).
- `root-bun-test.txt` - full root suite: the only failures (omo-senpi skills-sync artifacts, readOpencodeConfigAgents x2, dist bundle, installer version stamp) reproduce IDENTICALLY on clean origin/dev (environmental/pre-existing, unrelated to this diff; see dev-fails.txt/wt-fails.txt).

## Omitted

- No real user config touched: live drives ran in mktemp workspaces with LSP_TOOLS_MCP_USER_CONFIG pointed inside them.
- macOS temp paths in live captures are throwaway mktemp dirs.
