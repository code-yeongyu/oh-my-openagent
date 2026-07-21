# Reviewer-fix report - independent review blockers

## What changed
- Batch rejection now appends exactly one `steering_rejected` ledger entry, with `message` listing each rejected item index and its reasons. Plan writes remain zero on rejection.
- `appendLedgerEntries(repoRoot, entries, scope)` was added and accepted batch steering now writes all fresh accepted/criteria-revised entries plus any `batch_updated` entry in one filesystem append after one `writePlan`. Deduped items remain audit-free.
- CLI steering rejects simultaneous `--kind` and `--proposals-json` before mutation with typed code `ULW_LOOP_STEERING_BATCH_CONFLICT` and exit 1.
- Validation-batch schema failures now use the approved distinct codes: `ULW_LOOP_VALIDATION_BATCH_MEMBER_UNKNOWN`, `ULW_LOOP_VALIDATION_BATCH_FINAL_NOT_MEMBER`, and `ULW_LOOP_VALIDATION_BATCH_OVERLAP`; structural invalidity, duplicate members, and too-small batches retain `ULW_LOOP_VALIDATION_BATCH_INVALID`.

## RED/GREEN evidence
- RED commands and observed failures are preserved in `reviewer-fix-transcript.txt`.
- GREEN gates: focused Vitest seam, `npm run check`, full component `npm test`, hands-on built-CLI QA, and root `bun run test:codex` all passed.

## Supersession note
Prior task/F evidence remains historical for the original feature delivery. This report and `reviewer-fix-transcript.txt` supersede the earlier task-2/task-3/task-6/F1-F4 claims for the independent-review blocker details: rejection audit durability, plural accepted-batch append, CLI conflict typing, validation-batch branch codes, final component test count, and final scope state.

## Cleanup and scope
- The failed and passing reviewer-fix QA temp repos were removed; receipts are in `reviewer-fix-transcript.txt`.
- Real `~/.codex/config.toml` hash stayed `780c740e287bda48609b5c9d5ee3ee2fc20434ce1a58c36692ec07e279a161d5`.
- Root gate generated an out-of-scope CodeGraph dist comment rewrite; it was restored byte-for-byte from the clean main worktree before this evidence commit.
- The final evidence commit intentionally includes deletion of the three previously accidental `.omo` runtime files: `.omo/boulder.json`, `.omo/plans/ulw-loop-gajae-adoption.md`, and `.omo/start-work/ledger.jsonl`.
