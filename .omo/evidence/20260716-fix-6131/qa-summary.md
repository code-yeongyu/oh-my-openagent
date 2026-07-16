# QA Summary — fix #6131 (lsp_diagnostics freshness timeout for silent clean servers)

Date: 2026-07-16. Host: Windows 11, bun 1.3.14, node 24 (fnm). Workspace off OneDrive.

## Root cause (validated against source history)

`packages/lsp-core/src/lsp/client.ts` `diagnostics()` waits for fresh push diagnostics when
diagnostic pull is unsupported. A server that (a) never advertised `diagnosticProvider`
(or rejected `textDocument/diagnostic` with -32601) and (b) never publishes
`textDocument/publishDiagnostics` for a clean file — marksman's observed behavior in the
issue's protocol probe — leaves the wait with no possible satisfying event, so every
`lsp_diagnostics` call on a clean file ends as `freshness_timeout`.

Pre-regression contract (`git show cf65a63ab^:packages/lsp-core/src/lsp/client.ts`, lines
125-145): pull attempt swallowed unsupported errors and fell back to
`return { items: this.getStoredDiagnostics(uri) }` — an empty, non-error result. The
freshness hardening in cf65a63ab (PR #6097 chain) did not carry that terminal fallback for
the never-published + pull-unsupported case.

## Competing hypotheses considered

1. Reporter's theory — shared freshness path times out when pull unsupported and server
   silent: CONFIRMED (code walk + live repro below).
2. Daemon/proxy init failure (server never starts): REFUTED — issue shows `lsp_symbols`
   works; live repro shows initialize + didOpen round-trips succeed.
3. Intentional contract (owner's hardening tests demand timeout for silence): REFUTED for
   this case — existing tests assert timeout only when a publish EXISTS but is stale
   (integration tests at lines 76/99) or when an advertised pull hangs (line 240). The
   never-published + pull-unsupported case has no test and contradicts the pre-migration
   contract.

## Fix

`client.ts` deadline branch in the push-fallback path: when
`!this.isDiagnosticPullSupported() && snapshot.publishGeneration === 0`, return the stored
(empty) diagnostics instead of `freshness_timeout`. 10 product lines (comment included).
Stale-publish and hung-pull behavior unchanged (`publishGeneration > 0` / pull still
"supported" keep the timeout), full freshness window still honored before resolving clean.

## Artifacts (all produced with bash redirects, UTF-8)

- `red.txt` — new integration test on unmodified dev product code: FAILS for the
  behavioral reason (result carries `freshness_timeout` transientError). exit=1
- `green.txt` — same test on fixed head: 1 pass / 0 fail. exit=0
- `negative-control.txt` — product fix stashed, test re-run: fails again. exit=1
- `typecheck.txt` — `bun run typecheck` (includes lsp-core): exit=0
- `related-suites-dev-baseline.txt` — full `bun test packages/lsp-core` on unmodified dev:
  89 tests, 0 fail
- `related-suites-head.txt` — first full-package run on head: 2 unrelated
  workspace-mutation-lease tests failed (subprocess-timing flake on this Windows host)
- `related-suites-head-rerun.txt` — immediate rerun on identical head: 90 tests, 0 fail —
  confirms the two lease failures were host-timing flakes, not diff-caused
- `live-mcp-driver.mts` — driver spawning the production `omo-lsp mcp` stdio entry
  (`packages/lsp-tools-mcp/src/cli.ts mcp`) with real marksman 2026-02-08, isolated temp
  workspace + isolated `LSP_TOOLS_MCP_USER_CONFIG`
- `live-before-fix.txt` — REAL surface, unfixed dev: `isError: true`, "Timed out waiting
  for fresh diagnostics ... within 3000ms", `errorKind: freshness_timeout` — the issue's
  exact user-visible symptom
- `live-after-fix.txt` — REAL surface, fixed head: `isError: false`, "No diagnostics
  found" for the same clean README.md

## Not tested / residuals

- macOS/gopls variants of the reported class: not run on this host; the fix is
  OS-independent (Windows live proof mirrors the macOS report through the same shared
  client) and CI runs the suite on all three OSes.
- Latency: a silent-server clean file still waits the full 3000ms freshness window before
  resolving clean (unchanged timing contract; only the terminal result changes from error
  to empty). Shortening the wait would be a new timing contract — deliberately out of
  scope.
- Servers that publish real diagnostics slower than the freshness window lose them with
  and without this fix (the timeout path also returned zero diagnostics); this fix does
  not widen that pre-existing window semantics.
