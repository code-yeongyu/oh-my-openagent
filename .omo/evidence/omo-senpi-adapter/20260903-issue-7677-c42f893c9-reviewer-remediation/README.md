# Issue #7677 reviewer remediation at c42f893c9

> SUPERSEDED AS ACCEPTANCE EVIDENCE: this run remains the honest fail-closed proof that the broad real-home scan withholds certification at its 64 MiB bound. Use `../20260903-issue-7677-certified-isolation/` for the complete controlled live certification lane on the merged final source head.

This directory is the historical receipt set for source head `c42f893c953df103a38c42820568ccde34fcc215`. It supersedes both earlier issue #7677 directories, including the original 40-test receipt and the later 48-test Oracle receipt. No result here relies on either prior run.

## Fixed contracts

- Root-relative `sessions`, `cache`, `logs`, and `*.log` entries are excluded before file, entry, or byte accounting. The exact reviewer case (`sessions/x`, `stable`, and limits 1/1/100) is complete, untruncated, reads only `stable`, and consumes no volatile budget.
- Canonical certification requires both observations to carry the exact `nonvolatile-home` domain. Missing, arbitrary, and mismatched domains fail closed.
- Observation snapshots represent persistent directory existence with deterministic directory markers, so missing roots, empty roots, and empty nested directory creation/deletion compare differently.
- Recursive traversal validates `lstat` type and identity around directory opening, uses current `lstat` entry type rather than stale `Dirent` type, and never reads through a directory replaced by an external symlink.
- Protected-state reads reject symlinks and unsupported entries before open and use no-follow opens for regular-file races. External protected symlink targets are never read and certification remains fail closed.

## Exact verification

- RED first: `red-first.txt` records the exact five-suite command at baseline source `9e8ec6eb9`: 48 pass, 5 intended failures.
- GREEN: `focused-five-suites-53-tests.log` records that same exact command at `c42f893c9`: **53 pass, 0 fail, 212 assertions across 5 files**.
- Fresh driver self-test: `driver-self-test.txt` (`SELF-TEST OK`).
- Package typecheck: `typecheck.txt` (exit 0).
- Exact scoped eight-file Biome check: `biome-exact-eight-files.txt` (8 files, no fixes).
- LSP and no-excuse: `lsp-diagnostics.txt` and `no-excuse.txt` (zero diagnostics/violations).
- One full `bun run test:senpi`: `full-test-senpi-summary.txt` (2,572 pass, 7 platform skips, 0 fail; resolver 10 pass, 0 fail).
- Fresh installed-binary driver: `real-driver-command.txt` and sanitized `real-driver.jsonl`.

## Operational PASS is not certification

The real driver produced operational `result: "PASS"`, with ultrawork injection and comment checker both passing. It separately produced `isolationCertified: false`: the Senpi nonvolatile observation exceeded its bounded scan limit, so the canonical verifier correctly withheld certification even though protected snapshots were complete and no persistent changed path was observed. This distinction is intentional and must not be summarized as an isolation PASS.

## Source and scope

Fetched `origin/dev` remained `65c55dc6b470e0b21f60ff3c16c8e9594d575cd8`, already an ancestor of the branch, so no additional merge was required. Source fix commit: `c42f893c953df103a38c42820568ccde34fcc215`.

No `script/**`, native package/manifests, package manifests, lock/pins/patches, OAuth, CI, generated bundles/runtime, or unrelated source changed in this follow-up. Receipts contain no credential contents, protected hashes, environment dumps, tokens, auth headers, session identifiers, or unsanitized temporary paths.
