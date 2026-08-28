# QA evidence - LSP format capability, daemon format request, resident client cap

Branch: `feature/lsp-format-capability` | Date: 2026-08-27 | Base: `origin/dev` @ `339833ad5`

Implements DESIGN.md section 5.2 step 1 (daemon-first formatting through
`textDocument/formatting`) and section 5.6 rule 3 (`maxResidentClients` LRU cap).

## What was tested

### 1. Live daemon `format` request against a real language server (primary gate)

Driver: `packages/lsp-daemon/scripts/qa/format-request-e2e.mjs`
(`--self-test` supported; artifact `format-request-e2e.json`).

The driver spawns the REAL built daemon (`dist/cli.js daemon`) on its REAL unix socket and
sends authenticated `tools/call` frames with `name: "format"`. Language servers are real
repo-local devDependency installs (`bun add -d @biomejs/biome`, `bun add -d oxlint`) inside
throwaway fixture repos; no stubs are involved on either side of the socket.

Surfaces driven and the behavior each proves:

| Surface | Proves |
|---|---|
| `format` on a drifted `.css` file, biome resident | edits are requested, applied, and committed to disk |
| second `format` on the same file | an already-formatted file reports `unchanged` and is not rewritten |
| `format` on `.txt` (no configured server) | the pre-existing missing-dependency result is reused, not a new shape |
| `format` on `.ts` with oxlint pinned as the only server | the capability gate returns the typed unavailable result |
| `ps` process count after all requests | no new resident process is introduced |

### 2. Automated gates

- `bun test packages/lsp-core` - 145 pass (`green-02-format.log`)
- `npx vitest --run` in `packages/lsp-daemon` - 158 pass across 21 files (`green-03-daemon.log`)
- `bunx tsgo --noEmit -p packages/lsp-core/tsconfig.json` - clean
- `tsc --noEmit` + `biome check` on the four files this branch touches in lsp-daemon - clean

### 3. Failing-first captures

- `red-01-manager-cap.log` - 3 of 4 resident-cap tests fail before `maxResidentClients` exists
- `red-02-format.log` - format tests fail on missing `format-document.js` / `format.js`
- `red-03-daemon-client-surface.log` - client-surface tests fail before `callFormatViaDaemon` exists

## What was observed

Live run verdict: **PASS**, all 10 checks true (`format-request-e2e.json`).

```
firstFormat  : "Formatted /tmp/fq-*/fixture/drifted.css (+6/-3 lines)"
               {status:"formatted", linesAdded:6, linesRemoved:3}
   before     : 'a{color:red;background:blue}\n'
   after      : 'a {\n  color: red;\n  background: blue;\n}\n'
secondFormat : "Already formatted: .../drifted.css"
               {status:"unchanged", linesAdded:0, linesRemoved:0}   bytesChanged:false
unsupported  : "No LSP server configured for extension: .txt ..."
               {status:"unavailable", errorKind:"missing_dependency"}  bytesChanged:false
capability   : "Formatting unavailable for .../linted.ts: the language server does not
                advertise documentFormattingProvider."
               {status:"unavailable", reason:"capability_not_advertised"}  bytesChanged:false
residency    : {residentDaemons: 1}
```

The capability-gate case is the one that matters most for section 5.6: oxlint really does run,
really does complete `initialize`, and really does omit `documentFormattingProvider`. The request
returns a typed result instead of throwing, and the file is byte-identical afterwards.

A first attempt at the live run FAILED with `path must be shorter than SUN_LEN`, because biome's
`lsp-proxy` opens its own unix socket beneath the fixture and the macOS tmpdir path was too long.
That is a driver defect, not a product defect; the driver now allocates its work root under a short
temp path. The failure is recorded here because it is the reason the driver looks the way it does.

## Why it is enough

- Every success criterion is proven on the real surface a consumer will use: an authenticated
  daemon request over the real socket, not an in-process function call.
- Both formatting outcomes (`formatted`, `unchanged`) and both non-formatting outcomes
  (`capability_not_advertised`, missing dependency) are covered, each with a byte comparison, so
  "did not format" can never silently mean "corrupted the file".
- The resident-cap change is proven by unit tests that assert the evicted client was actually
  stopped, that a client with a live request is never evicted, and that the cap is exceeded rather
  than breaking an in-flight request.
- Memory safety per section 5.6: the run adds zero resident processes. Formatting reuses the
  language server the daemon already keeps warm, and the daemon count stays at 1.

## What was omitted

- No secrets, tokens, auth headers, env dumps, or credentials are recorded. The daemon auth token
  is generated per run inside a throwaway directory and is never written to any artifact.
- Absolute fixture paths appear inside `/tmp/fq-*` work roots that are deleted at the end of each
  run; they identify nothing about the host.
- `residentBiome` is reported but not asserted, because biome spawns short-lived helper processes
  that are not resident state; the meaningful invariant, asserted, is `residentDaemons == 1`.
- Windows was not exercised. The socket-length workaround is macOS/Linux specific; the daemon's own
  named-pipe path is covered by the existing package test suite.
