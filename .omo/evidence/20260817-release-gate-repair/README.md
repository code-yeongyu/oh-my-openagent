# beta.8 release-gate repair evidence

## What was tested
- The exact release-state failure surface: a version-bumped tree exactly as prepare-release-state produces it.
- RED/GREEN for both root causes and the full release-branch CI battery locally.

## What was observed
- RED-A: product-identity expected 5.0.0-beta.7, received 5.0.0-beta.8 on the bumped tree (the exact ubuntu CI failure).
- GREEN-A: dynamic stamped-version expectation passes 9/9 on the bumped tree and on unbumped dev.
- RED-B: the new workflow pin failed against the unmodified publish.yml.
- GREEN-B: pin passes after the prepare step rebuilds + force-stages Senpi bundles.
- SIMULATION: exact prepare bump sequence + rebuild committed on a local sim branch, then frozen install, bundle-freshness --check, stale-copy cleanup, full root bun test, typecheck, test:codex, and build all green (sim-battery.txt).

## Why it is enough
- The battery is the release-branch CI surface (test matrix essence + senpi-compatibility gate + codex gate + typecheck + build) executed on the exact tree the release PR will carry.
- No product code changed; both defects were release-pipeline seams.

## What was omitted
- Windows is not runnable locally (Parallels unavailable); Windows shards run in PR/release CI on the same deterministic tests.
- Raw 15k-line logs are summarized; no secrets captured.
