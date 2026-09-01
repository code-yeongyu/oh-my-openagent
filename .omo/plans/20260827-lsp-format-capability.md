# Plan: LSP formatting execution path + daemon format request + LspManager LRU cap

Design contract: `documents/omo-format-hook-design-20260827/DESIGN.md` section 5.2 step 1 (daemon-first
formatting via `textDocument/formatting`) and section 5.6 rule 3 (`maxResidentClients` LRU cap).
Memory-safety binding: no new resident processes. Formatting reuses the resident client the diagnostics
path already warms; the cap only reduces residency.

Scope: `packages/lsp-core/**` and `packages/lsp-daemon/**` plus their tests. Out of scope: omo-senpi,
comment-checker, config schemas, CLI formatter fallbacks, server-installation internals.

## Atomic steps

1. **RED: manager LRU cap test** (`packages/lsp-core/src/lsp/manager-max-clients.test.ts`)
   - cap 2, three distinct roots -> the least-recently-used idle client is stopped and dropped,
     the newest is resident, `clientCount() === 2`.
   - a client with `refCount > 0` (mid-request) is never evicted.
   - Verification: `bun test packages/lsp-core/src/lsp/manager-max-clients.test.ts` fails first.

2. **GREEN: `maxResidentClients` in `LspManager`** (default 6)
   - Evict before admitting a new client in `getClient` and `warmupClient`.
   - Eviction candidate: `refCount === 0 && pendingWaiters === 0 && !isInitializing`, lowest `lastUsedAt`.
   - Idle reaper untouched.

3. **RED: `formatDocument` tests** (`packages/lsp-core/src/lsp/format-document.test.ts`)
   - stubbed client returning TextEdits -> file rewritten, `{status:"formatted", linesAdded, linesRemoved}`.
   - server without `documentFormattingProvider` -> `{status:"unavailable", reason:"capability_not_advertised"}`
     and the file bytes are unchanged (byte compare).
   - server returning no edits / identical text -> `{status:"unchanged"}`.

4. **GREEN: `formatDocument`** (`packages/lsp-core/src/lsp/format-document.ts`)
   - `LspClient.formatDocument(filePath, options, signal)`: open/sync doc, capability gate,
     `textDocument/formatting`, return raw TextEdits or `null` when unsupported.
   - `LspClientTransport` records `documentFormattingProvider` from the initialize result.
   - Apply edits with the existing `normalizeTextEdits` helper; write via temp file + rename (atomic).
   - Line deltas computed from the normalized edits (before/after text of the edited spans).

5. **GREEN: `format` tool** (`packages/lsp-core/src/tools/format.ts` + definitions + types + index)
   - Missing server reuses `missingDependencyResult` (existing `not_installed` shape).
   - Update the pinned tool-surface test with the new descriptor.

6. **RED then GREEN: daemon routing + client surface**
   - `packages/lsp-daemon/test/request-routing.test.ts`: a `format` tools/call reaches the core handler.
   - `packages/lsp-daemon/src/client.ts`: `callFormatViaDaemon` + `LspFormatDetails` mirror of the
     core detail type; `client-surface.test.ts` pins it.
   - Protocol bookkeeping: format is an MCP tool like every other request, so
     `OMO_DAEMON_PROTOCOL_VERSION` stays 1 (no envelope change). The proxy protocol pin test covers it.

7. **QA + evidence**: `.omo/evidence/20260827-format-capability/`
   - lsp-core unit gate, lsp-daemon vitest gate, repo typecheck.
   - Live daemon QA: real `omo-lsp-daemon` over its unix socket, real `biome` LSP resolved repo-locally,
     `format` request against a drifted fixture file; capture the request/response and file before/after,
     plus a resident-process count proving no extra resident process.

## Verification per step

- Steps 1-5: `bun test packages/lsp-core`
- Step 6: `npm --prefix packages/lsp-daemon test`
- Step 7: `bun run typecheck`, live daemon driver output under the evidence dir.
