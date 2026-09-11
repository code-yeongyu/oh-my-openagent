# task batch run_in_background evidence (20260903-task-batch-rib)

Slug: `.omo/evidence/omo-senpi-adapter/20260903-task-batch-rib/`
Change: `packages/senpi-task/src/tools/task` — item-level `run_in_background` is honored as a batch-wide mirror (agreement hoisted, conflict = typed `invalid_arguments`), and a foreground batch streams per-child progress partials. Branch `fix/task-batch-run-in-background` off `origin/dev` `ed5eca467`.
Compute host for every transcript below: `gorky` (linux x86_64, bun 1.4.0, node 24.4.1) over the bunshin mesh at `/tmp/omo-taskrib-20260903`; nothing ran on the orchestrator machine.

Format per root `AGENTS.md` evidence bullets. No tokens, auth material, or API keys appear in any file here.

## unit-gate

- **WHAT WAS TESTED:** `bun test packages/senpi-task/src/tools/task` with the four new failing-first cases (item flag survives normalization; item-level `true` batch returns immediately without `manager.waitFor`; top-level/item and item/item conflicts return `invalid_arguments` and start no child; a foreground batch emits per-child progress partials), then the whole package and both typechecks.
- **WHAT WAS OBSERVED:** RED on the unfixed tree (tests only, tree `6adccea`): 5 fail / 191 pass — `[true,false,undefined]` normalized to `[undefined x3]`, foreground waits ran 2x for the item-level background batch, conflicts started 2 children, no child subscription within the 2s budget (`unit-gate/red.txt`, `unit-gate/red-detail.txt`). GREEN on the fixed tree: tools/task 196 pass / 0 fail; `bun test packages/senpi-task` 1847 pass / 1 skip (pre-existing Windows-only skip) / 0 fail; `tsgo --noEmit` for `packages/omo-senpi` and `packages/senpi-task` both exit 0 (`unit-gate/green.txt`).
- **WHY IT IS ENOUGH:** Each new assertion failed for the defect it names before the production change and passes after; the package suite and typechecks pin the adjacent spawn/batch/abort/budget paths.
- **WHAT WAS OMITTED:** Nothing; transcripts are the raw bun output filtered to non-passing lines.

## bundle

- **WHAT WAS TESTED:** `bun run build:senpi-plugin` (full stage chain) followed by `bun packages/omo-senpi/plugin/scripts/build-extension.mjs --check` on Linux with bun 1.4.0, the same platform CI uses for the digest check.
- **WHAT WAS OBSERVED:** Before the rebuild the check reported `stale-output` for `plugin/extensions/omo-task.js`; after the rebuild BUILD_RC=0, CHECK_RC=0 (`omo-senpi extension build is current`), and `omo-task.js` was the only tracked artifact that changed (sha256 `96260465549fde180de1e18ee6a82e1fc91f9b8cb4311b4b72297ba714bbc5f6`, 635572 bytes, byte-identical after transfer) (`unit-gate/build-senpi-plugin.txt`).
- **WHY IT IS ENOUGH:** The committed bundle is what a live senpi session executes; the digest check proves it matches the fixed sources.
- **WHAT WAS OMITTED:** Nothing.

## live driver (senpi-qa)

- **WHAT WAS TESTED:** `drive.mjs --self-test` (harness + isolation precondition) and `task-e2e.mjs` (single + batch task lifecycle against the real `node_modules/.bin/senpi` with the bundled mock provider, `TASK_E2E_OUT_DIR=live-task-dag`), run on the fixed tree and again on the pristine `ed5eca467` tree (senpi-task stashed, HEAD `omo-task.js`) for a same-host baseline.
- **WHAT WAS OBSERVED:** self-test `SELF-TEST OK`. Fixed tree: `spawn_background`, `batch_fanout_two_children`, `sync_inline_no_notification`, `negative_category_error`, `unconditional_wake`, `extension_suppression`, every `resume_*_setup`, `real_senpi_untouched` (`realSenpiUntouched: true`, changed paths `[]`), `no_leaked_pids` (0) all PASS; 8 revival-family checks FAIL (`followup_revive`, `task_output_peek`, `jsonl_sequence`, `resume_revived_resident`, `resume_finished_steerable`, `resume_cancel_not_revived`, `resume_killed_not_revived`, `resume_lru_evict_not_revived`). The pristine baseline on the same host reports the IDENTICAL 8 failures and the identical passes (`task-e2e-baseline-pristine.json`, `task-e2e-check-comparison.json`: zero differing checks).
- **WHY IT IS ENOUGH:** Every check the change can influence (spawn, background batch fan-out, sync inline batch, isolation, PID hygiene) passes live through the rebuilt bundle, and the revival-family failures are proven pre-existing on this host by the pristine run rather than introduced here.
- **WHAT WAS OMITTED:** The 8 pre-existing revival failures are NOT explained by this evidence; they are recorded for a separate investigation (dev `ed5eca467`, linux host). Sandbox agent dirs (`/tmp/omo-senpi-qa-*`) were deleted after each run (0 left); spawned PIDs were terminal (`leakedPids: 0`).
