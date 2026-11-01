# Root cause: issue #7165 (TypeScript 7 native LSP SIGSEGV in lsp_diagnostics)

## Exact crashing call sequence (oh-my-openagent <= 4.19.4 wire shape)

1. OMO spawns the user's custom TypeScript 7 native LSP (`tsc --lsp --stdio`, serverInfo
   `typescript-go 7.0.2`) and sends `initialize` (with params). The server responds OK.
   At this point typescript-go has NOT created its project session yet.
2. OMO sends the lifecycle notification **without a params field**:

   ```json
   {"jsonrpc":"2.0","method":"initialized"}
   ```

   (shipped artifact: `packages/lsp-tools-mcp/dist/mcp.js` line 1421 in
   oh-my-openagent@4.19.4, `await this.sendNotification("initialized")`).
3. typescript-go v7.0.2 `internal/lsp/lsproto/lsp.go` `UnmarshalParams`
   (lines 255-259) rejects absent params for every method that declares object
   params: "params must be an object or array". The `initialized` notification is
   dropped as InvalidParams, so `handleInitialized` never runs and
   `Server.session` stays nil forever (`s.session = project.NewSession(...)`
   lives inside `handleInitialized`, `internal/lsp/server.go:1245`).
4. OMO continues: `textDocument/didOpen` (guarded handler -> ServerNotInitialized,
   silently dropped), then `lsp_diagnostics` issues the `textDocument/diagnostic`
   request.
5. `textDocument/diagnostic` is registered via
   `registerLanguageServiceDocumentRequestHandler`, which - unlike
   `registerNotificationHandler` (server.go:819) and `registerRequestHandler`
   (server.go:840) - has NO nil-session guard. It dereferences
   `s.session.GetLanguageService(...)` at `server.go:865` on a nil receiver:

   ```
   panic: runtime error: invalid memory address or nil pointer dereference
   signal SIGSEGV: segmentation violation code=0x1 addr=0x3c8
   github.com/microsoft/typescript-go/internal/project.(*Session).getSnapshot(0x0, ...)
       .../project/session.go:909
   github.com/microsoft/typescript-go/internal/lsp.init.func1.registerLanguageServiceDocumentRequestHandler(...)
       .../lsp/server.go:865
   ```

   Exit code 2 / SIGSEGV. This is byte-for-byte the stack in the issue.

## Why the direct probe worked

The reporter's control probe sent `initialized` WITH an empty-object params
(`{"jsonrpc":"2.0","method":"initialized","params":{}}`), which satisfies
`UnmarshalParams`, so `handleInitialized` runs, the session is created, and the
same `textDocument/diagnostic` request returns `{"kind":"full","items":[]}`.

## Fix state

- The one-line production fix already landed on dev in commit `1b1211fcb`
  ("fix(lsp): send initialized notification params", 2026-07-22):
  `connection.ts` now sends `sendNotification("initialized", {})`.
- It first shipped in v5.0.0-beta.1. The 4.19.x stable line was branched before
  the fix (4.19.4 published 2026-08-01 still contains the paramless call), so
  stable users keep hitting #7165; a backport to the stable line is a
  maintainer decision.
- What was missing on dev is a regression test pinning the wire contract at the
  handshake boundary, so the params field can never be dropped again. This PR
  adds it: `packages/lsp-core/src/lsp/connection-initialized-params.test.ts`.

## Why not normalize params globally

Blanket injection of `params: {}` in the JSON-RPC framing layer would corrupt
messages that MUST stay paramless: typescript-go declares `shutdown`/`exit` as
NoParams and REJECTS them when params are present ("expected no params, got {}").
The contract is per-method; the test pins it at the connection boundary instead.

## Live verification against real tsgo 7.0.2 (linux x64)

Probe: `live-tsgo-probe.mjs` (output: `live-tsgo-probe-output.txt`), driving
`typescript@7.0.2` `tsc --lsp --stdio` over real stdio framing:

- Scenario A (4.19.4 wire shape, paramless `initialized`): process exits with
  code 2, stderr shows `panic: runtime error: invalid memory address or nil
  pointer dereference` / `signal SIGSEGV ... addr=0x3c8` - identical to the
  issue report.
- Scenario B (fixed wire shape, `initialized` with `{}`, plus the same
  didChangeConfiguration/didOpen/diagnostic sequence OMO sends): full roundtrip
  succeeds, diagnostic response `{"kind":"full","items":[]}` - matches the
  reporter's control probe.
