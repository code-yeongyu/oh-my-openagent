# QA evidence: issue #7165 - TypeScript 7 native LSP crash in lsp_diagnostics

Date: 2026-08-24
Branch: issue/7165-tsgo-lsp-crash (worktree oom-wt-7165, base dev)

## WHAT WAS TESTED

1. Live reproduction against the REAL TypeScript 7 native LSP
   (`typescript@7.0.2`, `tsc --lsp --stdio`, linux x64, installed in an
   isolated /tmp sandbox; no project or user config touched):
   - Scenario A: the oh-my-openagent 4.19.4 wire shape (`initialized`
     notification WITHOUT a params field), followed by OMO's exact
     didChangeConfiguration -> didOpen -> textDocument/diagnostic sequence.
   - Scenario B: the fixed wire shape (`initialized` WITH `{}` params) and the
     same request sequence, including answering the server's
     workspace/configuration and client/registerCapability roundtrips exactly
     like LspClientTransport does.
2. Failing-first proof of the new regression test
   `packages/lsp-core/src/lsp/connection-initialized-params.test.ts`:
   temporarily reverted connection.ts to the paramless `initialized` call,
   ran the test (red), restored it, ran again (green).
3. Scoped gates: `bun test packages/lsp-core` and
   `tsgo --noEmit -p packages/lsp-core/tsconfig.json`.

## WHAT WAS OBSERVED

- Scenario A: server process exits code 2 with
  `panic: runtime error: invalid memory address or nil pointer dereference`,
  `signal SIGSEGV ... addr=0x3c8` - byte-for-byte the crash signature reported
  in #7165 (see live-tsgo-probe-output.txt).
- Scenario B: full roundtrip succeeds, `textDocument/diagnostic` returns
  `{"kind":"full","items":[]}` - matches the reporter's control probe.
- Regression test: RED on pre-fix code (regression-test-red-before-fix.log,
  "1 fail"), GREEN on current dev (regression-test-green-after-fix.log,
  "2 pass").
- Scoped suite: 102 pass / 0 fail; typecheck exit 0 (scoped-gates.log).

## WHY IT IS ENOUGH

The probe drives the same binary and protocol sequence as the reporter's
environment and reproduces both the failure (A) and the recovery (B), proving
the root cause and that the dev-branch handshake satisfies tsgo 7.0.2's strict
params contract. The regression test pins the wire contract at the connection
boundary (initialize request carries object params; `initialized` notification
carries object params; lifecycle order initialize -> initialized ->
didChangeConfiguration), so the params field cannot silently disappear again.
Remaining risk: other language servers are unaffected by construction (the
change is test-only on top of the already-landed fix 1b1211fcb); the stable
4.19.x line still needs a maintainer backport of 1b1211fcb.

## WHAT WAS OMITTED

- The probe output contains full server capability dumps from tsgo (public
  protocol data, no secrets); kept as captured.
- No tokens, auth headers, user paths, or private config were recorded; the
  live probe ran entirely under /tmp/opencode/tsgo-live with its own npm
  sandbox.
- Root `bun install`'s prepare script fails in this worktree because the
  `packages/shared-skills/upstreams/open-design` submodule revision is not
  fetchable (unrelated to this change); dependency installation itself
  succeeded and all scoped gates above ran normally. Submodule state was
  restored before committing.

## Files

- root-cause.md - full causal chain with typescript-go v7.0.2 source lines
- live-tsgo-probe.mjs / live-tsgo-probe-output.txt - live two-scenario probe
- regression-test-red-before-fix.log - failing-first proof (pre-fix line)
- regression-test-green-after-fix.log - green on current dev
- scoped-gates.log - scoped bun test + typecheck results
