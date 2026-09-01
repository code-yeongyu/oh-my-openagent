# Task 3 - validation-batch schema evidence

## RED

Command: `npm test -- validation-batch cli-validation-batch`

Observed failure before implementation:
- `createUlwLoopPlan` ignored `validationBatchesJson`, so `plan.validationBatches` was absent.
- Unknown member ids were not rejected.
- CLI JSON output did not include validation batches.

## GREEN / component gates

Commands:
- Historical original gate: `npm test -- validation-batch cli-validation-batch plan-crud cli-create-goals`, `npm run typecheck`, `npm run build`.
- Reviewer-fix gate: `npm test -- steering-batch cli-steering-batch validation-batch cli-validation-batch`, `npm run check`, full `npm test`.

Observed:
- Historical original gate: 4 test files passed, 31 tests passed; TypeScript strict check passed; build passed.
- Reviewer-fix gate: 5 focused files / 22 tests passed; `npm run check` passed; full component suite passed 40 files / 418 tests.

## Real-surface QA

Built CLI: `dist/cli.js` in fresh `mktemp` git repo.

Scenarios:
- `create-goals --brief $'- Goal alpha\n- Goal beta' --validation-batch-json '[{"batchId":"VB001","memberIds":["G001-goal-alpha","G002-goal-beta"],"finalGoalId":"G002-goal-beta"}]' --json`
- Observed `plan.validationBatches[0].batchId == "VB001"`.
- Reviewer-fix CLI cases confirmed: `ULW_LOOP_VALIDATION_BATCH_MEMBER_UNKNOWN`, `ULW_LOOP_VALIDATION_BATCH_FINAL_NOT_MEMBER`, `ULW_LOOP_VALIDATION_BATCH_OVERLAP`, and retained `ULW_LOOP_VALIDATION_BATCH_INVALID` for duplicate/too-small structural invalidity.

Transcript summary printed by assertion:
- Historical: `validation batch create ok VB001`.
- Reviewer-fix: see `reviewer-fix-transcript.txt`.
