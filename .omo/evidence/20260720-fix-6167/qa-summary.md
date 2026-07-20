# QA & Evidence — fix(lsp-core) issue #6167

Windows `lsp_diagnostics` silently drops PowerShell Editor Services (PSES) diagnostics because
`openByUri` is keyed by `pathToFileURL(realpath)` (uppercase drive, `file:///C:/...`) while PSES
publishes `textDocument/publishDiagnostics` under a lowercase drive (`file:///c:/...`).
`recordPublishedDiagnostics` looks the state up by the server URI, misses the case-sensitive Map
key, and returns early — so `lastPublish` is never set and `diagnostics()` reports "No diagnostics
found" (or a freshness timeout). Reproduced and fixed on Windows 11, host platform for the bug.

## Competing hypotheses (investigation, before touching code)

- **H1 (drive-letter Map-key mismatch in `openByUri`) — CONFIRMED.** Verified against real
  `upstream/dev` source: `openDocumentSingleFlight` stores `state.uri = pathToFileURL(path).href`;
  `recordPublishedDiagnostics(params.uri)` reads by the raw server URI. Empirically confirmed
  `pathToFileURL` preserves input case but `realpathSync` returns an uppercase drive, so
  `state.uri` is uppercase while PSES publishes lowercase. Reproduced RED (unit) and end-to-end
  (live driver: `items = []`).
- **H2 (same freshness-timeout class as #6131/#6140) — REJECTED.** #6140 already fixed the
  silent-no-pull-server freshness path. This is a *deterministic drop at the Map boundary*, not a
  timing/freshness race: with the publish dropped, `state.publishGeneration` stays `0`, so
  `diagnostics()` returns a clean empty (`items:[]`, `transientError: undefined`) — the exact
  "No diagnostics found" symptom — not a `freshness_timeout`. Confirmed by the BEFORE live driver.
- **H3 (base transport `diagnosticsStore` is the user-visible path) — REJECTED.** The base
  `diagnosticsStore` (transport.ts) is keyed by the server URI, but `LspClient` overrides
  `getStoredDiagnostics` to read from `documents` (`openByUri`); the user-visible `diagnostics()`
  path resolves through `resolvePushDiagnostics` → `openByUri`. The base store read path is
  shadowed and out of scope (see Residuals).
- **H4 (`pathToFileURL` normalizes drive case, so there is no mismatch) — REJECTED empirically.**
  `pathToFileURL('c:\\x')` → `file:///c:/x`, `pathToFileURL('C:\\x')` → `file:///C:/x` (case
  preserved); `realpathSync` on the temp file returns `C:\...`, so the stored key is uppercase.

## Fix (product diff: 18 insertions / 8 deletions, 1 file)

`packages/lsp-core/src/lsp/workspace-document-state.ts`: add `normalizeDocumentUri()` (uppercases
the Windows drive letter of a `file:///` URI) and route every `openByUri` key access (store +
lookup, 8 sites) through it. `state.uri` and every outgoing wire URI (didOpen/didChange/didClose,
and the request URIs in client.ts) are left byte-identical — the only observable change is that a
server-published URI whose drive case differs now resolves to the same document. Normalizing both
store and lookup (rather than only the server-fed read) keeps the two sides consistent even if
`realpathSync` ever returns a lowercase drive, so the fix cannot introduce a new mismatch.

## What was tested / observed

- **RED (unit)** `red-6167.txt`: `resolvePushDiagnostics` → `{status:"missing"}` for a
  lowercase-drive publish through the real `openFile → recordPublishedDiagnostics` path. EXIT=1.
- **GREEN (unit)** `green-6167.txt`: same test → `{status:"ready", diagnostics:[...]}`; 3 pass. EXIT=0.
- **Negative control** `negative-control-6167.txt`: fix stashed, test fails again (`missing`). EXIT=1.
- **Regression** `related-suite-6167.txt`: `bun test packages/lsp-core` → 93 pass / 0 fail. EXIT=0.
- **Typecheck** `typecheck-6167.txt`: `bun run typecheck` (full monorepo, tsgo) → EXIT=0.
- **Live surface** `live-driver.mts` + `live-driver-before.txt` / `live-driver-after.txt`: the real
  `LspClient.diagnostics()` driven over real JSON-RPC stdio against the real fixture LSP server,
  configured to publish under a lowercase-drive URI (PSES behaviour). BEFORE fix: `items = []`
  (dropped). AFTER fix: `items = [<diagnostic>]`, `transientError = null`. Isolated in a `mktemp`
  workspace; the workspace is removed by the driver on exit.

## Why this is enough

The unit RED→GREEN pins the exact regression at the document-state boundary, the negative control
proves the test is coupled to the fix, and the live driver proves the same fix through the real
end-to-end execution path (transport → JSON-RPC → client → documents → `diagnostics()`) on the
actual platform where the bug occurs. The full `lsp-core` suite and monorepo typecheck confirm no
regression. The unit test is `skipIf(process.platform !== "win32")` because drive letters only
exist on Windows; CI's `windows-latest` job exercises it, and it ran RED→GREEN on this Windows host.

## Residuals / out of scope

- The base transport `diagnosticsStore` is stored by the server URI and deleted by
  `pathToFileURL` state URI, so a drive-case difference could leave a stale entry there. It is not
  on the user-visible diagnostics path (`getStoredDiagnostics` is overridden to read `openByUri`),
  so it is intentionally left untouched to keep blast radius minimal.
- Non-drive-letter URI quirks (percent-encoding, separators) are not addressed; the reported and
  reproduced defect is drive-letter case only.

## Omitted

No secrets, tokens, env dumps, or auth headers are present in these artifacts. Absolute temp paths
in logs are ordinary Windows temp directories (no credentials).
