# PR #7500 post-merge cleanup: final review evidence

## What was tested

- Driver contract RED: [`driver-contract-red.log`](driver-contract-red.log).
- Driver self-test: [`driver-self-test.log`](driver-self-test.log).
- Real `node_modules/.bin/senpi` live drive with an intentionally supplied caller
  `SENPI_CODING_AGENT_DIR`: [`driver-live.json`](driver-live.json), validated by
  [`driver-live-validation.json`](driver-live-validation.json).
- OAuth registration, compile-entry, driver/task-13, package/pin, package layout, build-binary, and
  stale-hooks cleanup checks: [`focused-tests.log`](focused-tests.log).
- Changed package/script typechecks, Biome, no-excuse, LSP diagnostics, and extension freshness:
  [`typecheck-build-receipt.txt`](typecheck-build-receipt.txt).
- One clean serialized `bun run test:senpi`: [`senpi-gate.log`](senpi-gate.log).
- Root npm dry run and clean packed `omo-ai` consumer resolution:
  [`packed-install-verdict.json`](packed-install-verdict.json).
- Compiled Linux OAuth credential derivation:
  [`compiled-oauth-verdict.json`](compiled-oauth-verdict.json).
- Task-owned resource removal and secret shredding: [`cleanup-receipt.txt`](cleanup-receipt.txt).

## What was observed

- The driver contract failed first because protected snapshots, bounded observations, and final JSON
  fields did not exist. GREEN is 14 pass / 0 fail across isolation and task-13 tests.
- The real live driver returned `PASS`, ignored the caller agent directory, used and removed its own
  sandbox, and reported empty protected changed paths for both `~/.senpi/agent` and `~/.omo/agent`.
- Full-tree observation was explicitly truncated for both homes at 10,000 files / 64 MiB / 20,000
  entries. It reported no observation errors. An ambient `~/.omo` change to `OmO-debug.log` was observed separately and were not attributed to QA or described as full-home
  integrity.
- OAuth/compile-entry tests: 26 pass. Driver/isolation tests: 14 pass. Package/pin/layout tests:
  30 pass. Build-binary tests: 21 pass / 1 unavailable-platform skip.
- The serialized Senpi gate passed 2,427 tests with 7 platform skips and 0 failures; the resolver
  contract passed 10 tests.
- `npm pack --dry-run` passed with 4,224 files. The clean consumer installed `omo-ai`
  `5.0.0-0.beta.30` and resolved pristine registry Senpi `2026.8.30-3` from the URL recorded in the
  packed-install verdict.
- The compiled Linux binary derived an exact 64-byte OpenAI Codex bearer token from mode-0600
  isolated state, exited 0, and emitted no stderr. Input and captured output were shredded.

## Why this is sufficient

Protected paths are the isolation verdict and include `auth.json`, `settings.json`, `models.json`,
`models-store.json`, `trust.json`, and `hooks-state.json`. Bounded recursive snapshots independently
report observed paths, completion, truncation, and errors, so a large or concurrently active home can
never be mislabeled untouched. The live harness proof is backed by unit contracts, package/build
gates, a clean packed consumer, and a compiled-binary OAuth derivation through the shipped surface.

## External gate

Senpi PR #1210 merged as `9e65ad35974b2cee055544301445de56cd822f1d` from reviewed head
`9644a13027f8bbe837a830578bfcff35ea715dec`. Packed OMO still resolves registry Senpi
`2026.8.30-3`, whose pristine hooks markers are recorded in the packed-install verdict. Hooks are not
green for npm consumers until Senpi publishes the merged implementation, OMO pins that release, and
a clean packed-install hooks test passes. `ELOCKED` is not a green result.

## What was omitted or redacted

- No auth file, token, secret, credential hash, private key, environment dump, or raw TUI redraw was
  retained.
- The random OAuth input and captured bearer output were compared locally and shredded; only byte
  counts, exact-match status, mode, exit/stderr status, and binary SHA remain.
- Recursive observations retain only changed relative paths and bounded status, never file contents
  or file hashes.
