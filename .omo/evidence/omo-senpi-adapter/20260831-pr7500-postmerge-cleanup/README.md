# PR #7500 post-merge cleanup: current-dev combined evidence

Validated source head: `81b673b7df987e7088bfa240e7d6a76ce01617b4`.

This head contains normal merge `5baeb6c77c5b0e72dedc149d35ae6c273c1d3c43`, whose parents are cleanup
head `cd17abb4b7bd2e709bafd4596b4d3d278659e20d` and `origin/dev`
`b52f098280e812506c7fa83f513ee9b921d6c108`, plus one behavior-neutral hooks-test type narrowing.

## Merge resolution

- `drive.mjs`: retained mutation-safe protected snapshot verdicts/fields. Integrated current-dev
  complete-tree inventories, volatile classification, volatile `settings.json` normalization, and
  transient `ENOENT`/`ENOTDIR` tolerance into bounded observations. Complete-tree evidence remains
  supporting evidence; protected state remains the fail-closed isolation verdict.
- All current-dev hooks regressions and referenced fixtures were restored. They exercise pristine
  installed Senpi 2026.8.31; no deleted downstream hooks patch or trust-storage transform returned.
  One test-only `Error.code` access was narrowed for script typecheck.
- `packages/omo-native/senpi-patch.mjs` and its packed test are byte-identical to current dev. The
  installer contains only the `describeUnclaimedResult` Claude OAuth transform.
- Mutation-safe metadata windows, ENOENT-only protected absence, RED evidence, and byte bounds remain.

## Exact-head gates

- Combined isolation/task: 26 pass; upstream hooks: 9 pass; OAuth/compile-entry: 26 pass;
  package/pin: 20 pass; packed OAuth consumer: 1 pass.
- Real Senpi driver: PASS; protected snapshots complete/error-free/untouched; complete-tree inventory
  present; observations bounded; caller directory ignored; sandbox removed.
- Serialized gate: 2,468 pass, 7 platform skips, 0 fail; resolver 10 pass, 0 fail.
- Extension freshness, relevant typechecks, LSP, and Biome completed. Integration-owned no-excuse
  passes. The byte-exact current-dev packed test retains three pre-existing non-null assertions that
  the all-files no-excuse invocation reports; runtime and typecheck pass.

## Release-gate facts

Current dev independently landed (1) packed-consumer postinstall proof for the OAuth-only transform
and (2) root-worktree regressions for pristine upstream Senpi 2026.8.31 hooks behavior. Neither is a
clean packed-consumer hooks semantics proof. That gate remains separate and missing.

Evidence contains no protected bytes, hashes, secrets, private keys, tokens, or raw environment output.
