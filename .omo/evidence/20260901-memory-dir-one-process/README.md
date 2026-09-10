# Memory directory one-process verification

## WHAT TESTED
- `bun test packages/omo-senpi/src/components/memory/` from the clean `origin/dev` worktree, in one Bun process.
- The same command was run twice consecutively after restoring the checked-out sources.
- The lazy-boundary regression was inspected in `packages/senpi-task/src/lazy/pi-tui.ts`, `senpi-barrel.ts`, and `packages/omo-senpi/src/extension/compose.ts`.
- A controlled pre-fix source substitution was run for diagnosis only and was restored before verification.

## OBSERVED
- `before-origin-dev.txt`: 1,029 pass, 0 fail (the reported ~72 failures were not reproducible on `origin/dev`).
- `before-pre-fix-experiment.txt`: 1,029 pass, 0 fail; the memory directory does not instantiate the duplicated production bundles, so this source-only test command cannot expose the historical bundle-copy fault.
- `after-run-1.txt`: 1,029 pass, 0 fail.
- `after-run-2.txt`: 1,029 pass, 0 fail.
- No source files were changed in this branch. The relevant production fix is already present on the base as `40e0cca14` (cross-bundle `Symbol.for` state) and `bb2af9c96` (compose-level warm-up).

## WHY ENOUGH
The requested whole-directory command is green in one process on two consecutive runs, and the relevant historical fix and regression test are present in the base branch. The controlled pre-fix experiment establishes that the memory-directory command alone cannot reproduce the production bundle split; claiming a new source fix would be unsupported.

## OMITTED
- No fabricated 72-failure baseline: the supplied failure is absent on the fetched `origin/dev`, and no failure count can honestly be reported for this checkout.
- No redundant production or test change: the root-cause fix and cross-bundle test already exist in the base branch.
