# Task 1 - checkpoint auto-advance evidence

## RED

Command: `npm test -- checkpoint-continuation cli-checkpoint`

Observed failure before implementation:
- `test/checkpoint-continuation.test.ts` failed to import missing `../src/checkpoint-continuation.js`.
- CLI JSON continuation assertion failed because checkpoint output did not include `next` and left `G002-goal-b` pending.

## GREEN / component gates

Commands:
- `npm test -- checkpoint-continuation cli-checkpoint-continuation`
- `npm run typecheck`

Observed:
- 2 test files passed, 5 tests passed.
- TypeScript strict check passed.

## Real-surface QA

Command: `npm run build`, then built `dist/cli.js` in fresh `mktemp` git repos.

Scenarios:
1. Created canonical plan with `--brief $'- Goal alpha\n- Goal beta'`.
2. Passed essential criteria C001/C002 for `G001-goal-alpha`.
3. Ran `checkpoint --goal-id G001-goal-alpha --status complete --codex-goal-json <aggregate active> --json`.
   - Observed `next.goal.id == "G002-goal-beta"`.
   - Observed `next.goal.status == "in_progress"`.
   - Follow-up `status --json` showed `plan.activeGoalId == "G002-goal-beta"`.
4. Repeated with `--no-advance`.
   - Observed no `next` property.
   - Observed no `plan.activeGoalId`.
5. Ran `checkpoint --status failed` on a fresh plan.
   - Observed no `next` property.
   - Observed `G002-goal-beta` remained `pending`.

Transcript summary printed by assertion script:
- `auto-advance ok G002-goal-beta G002-goal-beta`
- `no-advance ok`
- `failed-no-advance ok`
