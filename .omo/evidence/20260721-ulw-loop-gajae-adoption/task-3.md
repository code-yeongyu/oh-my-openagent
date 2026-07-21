# Task 3 - validation-batch schema evidence

## RED

Command: `npm test -- validation-batch cli-validation-batch`

Observed failure before implementation:
- `createUlwLoopPlan` ignored `validationBatchesJson`, so `plan.validationBatches` was absent.
- Unknown member ids were not rejected.
- CLI JSON output did not include validation batches.

## GREEN / component gates

Commands:
- `npm test -- validation-batch cli-validation-batch plan-crud cli-create-goals`
- `npm run typecheck`
- `npm run build`

Observed:
- 4 test files passed, 31 tests passed.
- TypeScript strict check passed.
- Build passed.

## Real-surface QA

Built CLI: `dist/cli.js` in fresh `mktemp` git repo.

Scenario:
- `create-goals --brief $'- Goal alpha\n- Goal beta' --validation-batch-json '[{"batchId":"VB001","memberIds":["G001-goal-alpha","G002-goal-beta"],"finalGoalId":"G002-goal-beta"}]' --json`
- Observed `plan.validationBatches[0].batchId == "VB001"`.

Transcript summary printed by assertion:
- `validation batch create ok VB001`
