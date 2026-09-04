# Issue #7677 bounded live isolation certification

Canonical acceptance evidence for final source head `509929c8266467ce1a8a07f4ea5a027461436149`. The review provenance is explicit: reviewed exact head `d2489baeeb51973d456d0f6ea06b758a75961a81` is evidence-only relative to original source fix commit `a0aff6422546ac1267b88dd1b0ff8144421e5483` for all source-bearing paths. The exact empty source-only diff and the actual `origin/dev` ancestor `05a1fbcc7ce310734d6646cdee2d80855bdb3506` are recorded in `exact-head-provenance.txt` and `repository-integrity.txt`.

## What was fixed and tested

- Volatile `*.log` regular files are classified before entry-budget accounting, matching volatile directory handling.
- Directory enumeration stops after bounded nonvolatile lookahead instead of materializing every entry.
- Final directory metadata detects persistent entries created or removed during traversal.
- Post-open setup failures close both the directory handle and raw descriptor while retaining primary-error precedence.
- Final regular-file identity uses no-follow metadata, so a post-read replacement symlink is never dereferenced.
- Only direct `ENOENT` represents a missing root; root `ENOTDIR` fails closed in bounded snapshots and directory digests.
- Deterministic RED receipts for all seven findings and the GREEN focused run are recorded in `red-first.txt` and `focused-seven-suites-76-tests.log`.
- The authoritative `bun run test:senpi` passed with 2687 tests, 7 platform skips, and 0 failures, followed by 10 passing evidence-resolver tests.
- Typecheck, exact changed-file Biome, no-excuse, changed-file LSP diagnostics, driver self-test, and the installed real Senpi driver all passed.

## Live isolation outcome

The real driver returned operational `result:PASS` with `isolationCertified:true`. The controlled environment-root lane was complete, untruncated, error-free, and had zero changed paths. Broad real-home observation remained honestly fail-closed because the Senpi home exceeded the 64 MiB bound; it was not repurposed as certification. Absolute user paths and temporary sandbox names are sanitized in `real-driver.jsonl`.

## Integrity

Restricted integrity is measured from the actual `origin/dev` ancestor `05a1fbcc7ce310734d6646cdee2d80855bdb3506`, not merely from the original source fix. The reviewed head has zero drift in script/script directories, native files, manifests, lock/pins/patches, OAuth, CI workflows, and generated bundles. The only final source delta after `d2489baeeb51973d456d0f6ea06b758a75961a81` is the five listed isolation source/test files. `sha256.txt` covers every evidence artifact, including the force-added `exact-head-provenance.txt`.
