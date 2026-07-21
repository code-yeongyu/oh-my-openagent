# Task 2 - atomic batch steering evidence

## RED

Command: `npm test -- steering-batch cli-steering-batch`

Observed failure before implementation:
- `test/steering-batch.test.ts` failed to import missing `../src/steering-batch.js`.
- `parseSteeringProposals` was not exported from `cli-steering.ts`.

## GREEN / component gates

Commands:
- `npm test -- steering-batch cli-steering-batch steering cli-steering`
- `npm run typecheck`
- `npm run build`

Observed:
- 6 test files passed, 78 tests passed.
- TypeScript strict check passed.
- Build passed.

## Real-surface QA

Built CLI: `dist/cli.js` in fresh `mktemp` git repos.

Scenarios:
1. `steer --proposals-json` with two valid proposals (`annotate_ledger`, `revise_criterion`).
   - Observed accepted batch result with `results.length == 2`.
   - Observed `G001-goal-alpha` criterion C001 scenario changed to `observable revised scenario`.
2. `steer --proposals-json` with first valid `add_subgoal` and second invalid `reorder_pending` using `missing`.
   - Observed rejected batch result with `unknown pending id`.
   - Compared `.omo/ulw-loop/goals.json` before/after; byte string was unchanged, proving no partial plan mutation.

Transcript summary printed by assertions:
- `batch accepted ok 2`
- `batch rejection atomic ok unknown pending id`
