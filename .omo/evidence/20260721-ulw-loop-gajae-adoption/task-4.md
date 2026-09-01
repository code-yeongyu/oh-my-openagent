# Task 4 - validation-batch checkpoint/steering enforcement evidence

## RED

Commands:
- `npm test -- validation-batch-checkpoint`
- `npm test -- steering-batch`

Observed failures before implementation:
- Batch-final checkpoint did not reject open members or require batch gates.
- Batch gate criteria/coverage checks were absent.
- Splitting a batch member did not update validation-batch membership or emit `batch_updated`.

## GREEN / component gates

Commands:
- `npm test -- validation-batch-checkpoint steering-batch steering plan-io checkpoint`
- `npm run typecheck`
- `npm run build`

Observed:
- 14 test files passed, 143 tests passed.
- TypeScript strict check passed.
- Build passed.
- LOC audit: `checkpoint.ts` 249, `steering.ts` 203, `steering-mutations.ts` 52, `validation-batch.ts` 104 pure LOC.

## Real-surface QA

Built CLI: `dist/cli.js` in fresh `mktemp` git repos.

Scenarios:
1. Created 3-goal plan with `VB001` over `G001-goal-alpha` and `G002-goal-beta` where `G002` is final.
2. Attempted to checkpoint `G002-goal-beta` while `G001-goal-alpha` remained pending.
   - Observed JSON error `ULW_LOOP_VALIDATION_BATCH_OPEN`.
3. Created fresh 3-goal plan with same batch and ran `steer --proposals-json` split on `G001-goal-alpha`.
   - Observed validation batch memberIds changed to `G004,G002-goal-beta` and removed `G001-goal-alpha`.

Transcript summary printed by assertions:
- `batch open gate ok ULW_LOOP_VALIDATION_BATCH_OPEN`
- `batch split update ok G004,G002-goal-beta`
