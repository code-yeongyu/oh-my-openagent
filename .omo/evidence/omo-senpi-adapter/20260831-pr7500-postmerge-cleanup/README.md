# PR #7500 post-merge cleanup: final combined-head evidence

Validated production/source head: `c5000ed2041ce8b0897cfcbebf9dbcabde9b5c71`, the normal merge of cleanup head `704431497b0bd88ed498aa1db26ee563fde31a58` with `origin/dev` `c53faf72fd05c32be7521eb8e406685cb1eb4115`. The final evidence-only follow-up does not change validated runtime source.

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
- Merge ancestry and exact-head gate summary: [`post-merge-receipt.json`](post-merge-receipt.json).
- Task-owned resource removal and secret shredding: [`cleanup-receipt.txt`](cleanup-receipt.txt).

## What was observed

- The conflict-free merge preserved the cleanup isolation implementation and added current-dev memory
  recall, DAG queued-promotion handling, and regenerated OMO Senpi bundles.
- The real live driver returned `PASS` on the combined source head, ignored the caller agent
  directory, removed its sandbox, and reported empty protected changed paths for both real homes.
- Full-tree observation was explicitly truncated for both homes at 10,000 files / 64 MiB / 20,000
  entries with no observation errors. Ambient `~/.omo` changes to `OmO-debug.log` and `settings.json`
  were reported separately and were not attributed to QA or described as full-home integrity.
- OAuth/compile-entry tests: 26 pass. Driver/isolation tests: 14 pass. Package/pin/layout tests:
  30 pass. Merged memory/DAG tests: 175 pass. The three files affected by aggregate timeouts passed
  67 focused tests with 0 failures on the exact source head.
- The one serialized `bun run test:senpi` aggregate reached 2,445 pass and 7 platform skips, then
  recorded 8 timeout-only failures under workstation load. All affected tests passed immediately as
  one focused exact-source run, and those test files are byte-identical to upstream dev. This is
  recorded as a nonreproducing aggregate timeout result, not mislabeled as a green full gate or as a
  proven baseline product failure.
- The resolver contract passed 10 tests. Extension freshness, OMO Native, OMO Senpi, Senpi Task, and
  script typechecks passed.
- `npm pack --dry-run` passed with 4,224 files. The clean consumer installed `omo-ai`
  `5.0.0-0.beta.30` and resolved pristine registry Senpi `2026.8.30-3`.
- Because current dev changed generated bundles embedded by the binary, compiled Linux OAuth was
  rebuilt and rerun: exact 64-byte token match, mode 0600, exit 0, and no stderr. Input and captured
  output were shredded.

## Why this is sufficient

Protected paths are the isolation verdict and include `auth.json`, `settings.json`, `models.json`,
`models-store.json`, `trust.json`, and `hooks-state.json`. Bounded recursive snapshots independently
report observed paths, completion, truncation, and errors, so a large or concurrently active home can
never be mislabeled untouched. The live harness proof is backed by unit contracts, merged memory/DAG coverage, package/build gates,
a clean packed consumer, and a rebuilt compiled-binary OAuth derivation through the shipped surface.
The aggregate timeout result and its passing focused attribution are both retained so reviewers do
not have to infer or trust an undocumented green claim.

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
