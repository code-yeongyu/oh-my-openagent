# PR #7500 post-merge cleanup

## Retained OAuth behavior

- Compiled OMO OAuth runtime registration predates PR #7500 in commit `59f56836a`.
- A fresh-process behavior test now proves that importing `compile-entry` replaces a sentinel bundled
  loader with the real nested OpenAI Codex OAuth flow. It fails when the top-level registration call
  is absent and passes on the retained runtime implementation.
- Compiled Linux binary QA derived the stored OpenAI Codex bearer token from an isolated random
  64-byte secret; the input and captured output were shredded after comparison.

## Removed downstream carry

- The stale hooks trust-storage patch, its implementation fixtures/tests, and the misleading QA
  driver changes are removed.
- PR #7500's ineffective OAuth/module-identity tests and source-regex import guard are removed.
- The three mixed OAuth/hooks evidence bundles from PR #7500 are replaced by this sanitized record.

## Validation

- OAuth compile-entry tests: 26 pass, 0 fail; the registration mutation produced the expected RED.
- Binary build tests: 21 pass, 1 unavailable-platform skip, 0 fail.
- Package-shape/pin tests: 30 pass, 0 fail.
- Reverted driver self-test/task-13: 11 pass, 0 fail; extension `--check` is current.
- Changed package/script typechecks and LSP diagnostics: clean.
- `bun run test:senpi`: 2,424 pass, 7 platform skips, 0 fail; evidence resolver: 10 pass.
- `npm pack --dry-run`: pass, 4,224 files.
- Clean packed `omo-ai` consumer install resolved
  `https://registry.npmjs.org/@code-yeongyu/senpi/-/senpi-2026.8.30-3.tgz` and pristine hooks storage.

## External gate

Normal packed `omo-ai` installs resolve pristine registry Senpi `2026.8.30-3`; the repository-root
Bun patch is not applied inside a clean consumer install. Senpi PR #1210 merged as
`9e65ad35974b2cee055544301445de56cd822f1d` from reviewed head
`9644a13027f8bbe837a830578bfcff35ea715dec`; hooks behavior therefore remains gated only on
publishing a Senpi release containing that merged implementation, pinning the published version in
OMO, and testing a clean packed install against it. This cleanup does **not** claim that
npm-installed hooks are fixed; `ELOCKED` is not a green feature result.

## Isolation and status

- Verification used temporary isolated homes and agent directories.
- Nonvolatile real credential files were byte-identical before and after compiled-binary QA; real
  user state was untouched.
- No OMO package was published from the unsafe merged state.
- All cleanup processes and temporary directories were removed; cleanup is complete.
