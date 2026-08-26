# Self-audit ledger - issue #7339 fix

Protocol: after each final source edit, re-read the fresh full git diff from disk plus adjacent callers/owners/teardown/error/platform paths; classify findings P0/P1/P2/P3/noise; any edit resets the clean streak and starts a new full wave. "Previously reviewed", "no new diff", and "tests pass" are not accepted as clean-wave evidence.

## Wave 0 - pre-fix exploration (finding wave, does not count)

Scope: worker creation path (task tool execute, dag start/amend, runners), lazy boundary modules, compose/bundle topology, built artifacts.

- P1 FOUND: bb2af9c96 moved the loadPiTui() warm-up into compose (omo.js bundle); omo-task.js copy left cold AND dead-code-eliminated into an unconditional throw. Fixed by restoring the in-component warm-up.
- P1 FOUND: dag manager.start/amend reach senpiBarrel() synchronously via skill materialization with no awaited load on the path. Fixed with a guarded await at the async entry points.
- P3 FOUND (accepted): stale comments claimed compose's warm-up covers every component and that only the task spawn path reaches the fs skill loader. Corrected.

Edit made -> clean streak reset to 0.

## Wave 1 - audit of the first fix draft

Scope: full diff of the fix + adjacent seams: node-retry/node-send, scheduler admission, recovery, rpc bridges, member bundle, teardown/dispose paths, platform-specific code (none touched).

- P1 FOUND: unconditional `await loadSenpiBarrel()` inside createDagManager.start/amend breaks node-retry's amendRetryPrompt, which fires `void manager.amend(...)` and SYNCHRONOUSLY reads the mutated checkpoint; even a resolved-promise await yields once, so amendRun deferred and the fingerprint read went stale -> spurious "prompt override was rejected" on EVERY retry-with-prompt, warm barrel included.
- FIX APPLIED: added isSenpiBarrelLoaded() to lazy/senpi-barrel.ts and gated both awaits on it (warm = zero yield, synchronous body preserved; cold = one awaited load). Clean streak reset to 0. Coverage widened: focused suite now runs the FULL packages/senpi-task/src/dag tree (scheduler, node-retry, e2e) instead of manager.test.ts alone.
- NOISE (accepted): probe fixtures mkdtemp under /tmp without cleanup (same pattern as the existing cold-pi-tui-probe fixture); residue removed in cleanup.

## Wave 2 - audit of the final code (post final edit)

Scope: complete fresh `git diff` re-read from disk (8 modified files), all 5 new files, rebuilt artifacts re-inspected byte-level, adjacent callers re-grepped (void-callers scan: node-retry is the only sync-read consumer; all other start/amend callers await properly), artifact throw-site/import matrix re-verified for all six bundles.

- ZERO findings.

## Wave 3 - confirmation wave (post final edit, no edits between waves 2 and 3)

Scope: gates re-run over the frozen tree (254 tests x2 consecutive clean, tsgo x2 CLEAN, git diff --check CLEAN, bundle assertion green, both probes green, artifact QA green), git status reconciled against the expected dirty set (8 modified + 5 new source/test files + evidence dir; nothing else).

- ZERO findings.

Result: two consecutive post-final-edit waves (2 and 3) with empty ledgers. Audit scope commands: `git diff`, `git status --short`, `bun test packages/senpi-task/src/dag packages/omo-senpi/src/components/task/register-warms-pi-tui.test.ts packages/omo-senpi/src/components/task/bundle-pi-tui-loader.test.ts packages/omo-senpi/src/extension/compose-cold-pi-tui.test.ts` (x2), `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`, `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`, `git diff --check`, `node packages/omo-senpi/plugin/scripts/build-extension.mjs`, artifact greps for throw-sites/imports across plugin/extensions/*.js.
