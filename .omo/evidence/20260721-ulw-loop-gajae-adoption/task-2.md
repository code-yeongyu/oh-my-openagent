# Task 2 - atomic batch steering evidence

## RED

Command: `npm test -- steering-batch cli-steering-batch`

Observed failure before implementation:
- `test/steering-batch.test.ts` failed to import missing `../src/steering-batch.js`.
- `parseSteeringProposals` was not exported from `cli-steering.ts`.

## GREEN / component gates

Commands:
- Historical original gate: `npm test -- steering-batch cli-steering-batch steering cli-steering`, `npm run typecheck`, `npm run build`.
- Reviewer-fix gate: `npm test -- steering-batch cli-steering-batch validation-batch cli-validation-batch`, `npm run check`, full `npm test`.

Observed:
- Historical original gate: 6 test files passed, 78 tests passed; TypeScript strict check passed; build passed.
- Reviewer-fix gate: 5 focused files / 22 tests passed; `npm run check` passed; full component suite passed 40 files / 418 tests.

## Real-surface QA

Built CLI: `dist/cli.js` in fresh `mktemp` git repos.

Scenarios:
1. `steer --proposals-json` with two valid proposals (`annotate_ledger`, `revise_criterion`).
   - Observed accepted batch result with `results.length == 2`.
   - Observed `G001-goal-alpha` criterion C001 scenario changed to `observable revised scenario`.
2. `steer --proposals-json` with first valid `add_subgoal` and second invalid `reorder_pending` using `missing`.
   - Observed rejected batch result with `unknown pending id`.
   - Compared `.omo/ulw-loop/goals.json` before/after; byte string was unchanged, proving no partial plan mutation.
3. Reviewer-fix QA re-ran rejected batch with two invalid items.
   - Observed goals byte-identical and exactly one `steering_rejected` ledger entry.
   - Observed message `index 1: unknown pending id; index 2: split_subgoal requires target`.
4. Reviewer-fix QA re-ran accepted batch plus replay.
   - Observed accepted order `G003,G001-goal-alpha,G002-goal-beta`.
   - Observed replay all deduped with ledger count unchanged `3 -> 3`, proving replay dedup produced no new mutation/audit.

Transcript summary printed by assertions:
- Historical: `batch accepted ok 2`; `batch rejection atomic ok unknown pending id`.
- Reviewer-fix: see `reviewer-fix-transcript.txt`.
