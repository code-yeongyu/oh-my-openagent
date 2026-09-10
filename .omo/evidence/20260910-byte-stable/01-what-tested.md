# WHAT WAS TESTED (20260910-byte-stable, worktree wt-byte-stable)

Change under test: docs only. One new file,
`packages/omo-opencode/src/plugin/prefix-stability.md` (ordered prefix
contract, cache breakers, S1/S2/S3 wording, regen procedure, merge note).
No code behavior changed, so QA proves nothing regressed.

1. Golden gate, no regen flag (S3 fixture comparison):
   `bun test packages/omo-opencode/src/plugin/prefix-stability-golden.test.ts`
   Raw: `golden-test-output.txt`.
2. Neighbor prefix-stability suites (freeze, chain order, todo memo,
   volatile tail, prefix hash, stable stringify):
   `bun test` over `tool-registry-freeze.test.ts`,
   `messages-transform-chain-order.test.ts`, `tool-definition.test.ts`,
   `volatile-tail.test.ts`, `prefix-hash.test.ts`, `stable-stringify.test.ts`
   Raw: `scoped-suites-output.txt`.
3. Scoped typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
   Raw: `typecheck-output.txt`.
4. opencode-qa harness, sandboxed where possible:
   `common.sh --self-check`, `sse-hook-probe.sh --self-test`,
   `server-smoke.sh --self-test`
   Raw: `common-selfcheck-output.txt`, `sse-selftest-output.txt`,
   `server-smoke-output.txt`.

Isolation: every opencode-qa script runs in an isolated XDG sandbox (temp
dirs for data, config, state, cache) and never targets the live DB. No
session was created, resumed, or prompted. Proof in `02-observed.md` and
`isolation-proof.txt`.
