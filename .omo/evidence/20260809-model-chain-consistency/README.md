# Canonical model-chain runtime fallback

Issue: #6644

## Behavioral proof

- Negative control (legacy-only implementation): 5 new tests failed, 9 passed.
- Patched focused suite: 255 passed, 0 failed.
- Related config and Doctor suites: 21 passed, 0 failed.
- Typecheck and build: passed.
- Full suite: 13,420 passed, 5 skipped, 1 unrelated failure.

The unrelated failure is `packages/ast-grep-mcp/src/tools/scan.test.ts`: the
SHA-verified asset referenced by the repository's 0.43.0 manifest reports
`ast-grep 0.42.1`. The same failure reproduces in an isolated HOME.

## Isolated OpenCode QA

- OpenCode: 1.18.15.
- Self-check: isolated HOME/XDG paths and database guard passed.
- SSE probe: received `server.connected`.
- Live OpenCode database session count stayed at 7,125 before and after QA.
- `doctor --verbose` scanned `home/.omo/omo.jsonc` and reported the config as
  valid, with no unknown-key or deprecated-key warning for `models` or
  `reasoning`. Its non-zero exit was limited to expected isolated-environment
  warnings (plugin registration, auth, cache/models).
- `runtime-fallback-model-chain-probe.ts` exercised the production hook. It
  aborted the failed primary session once and dispatched one continuation to
  `openai/canonical-fallback`; the legacy fallback did not win precedence.

Run the focused proof:

```sh
bun test packages/omo-opencode/src/hooks/runtime-fallback
bun .omo/evidence/20260809-model-chain-consistency/runtime-fallback-model-chain-probe.ts
```
