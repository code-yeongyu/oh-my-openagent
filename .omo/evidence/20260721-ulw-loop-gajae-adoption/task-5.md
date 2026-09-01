# Task 5 - docs/help evidence

## Changes reviewed

Updated:
- `ULW_LOOP_HELP` for `--no-advance`, `--proposals-json`, and `--validation-batch-json`.
- README CLI table and validation-batch explanation.
- Skill full workflow for auto-advance, manual fallback, batch steering, and validation batches.
- Stop-resume directive to note that checkpoint prints the next goal instruction.

## Verification

Commands:
- `npm test -- cli-helpers stop-resume`
- `npm run typecheck`
- `npm run build`

Observed:
- 2 test files passed, 34 tests passed.
- TypeScript strict check passed.
- Build passed.

Manual QA by read:
- Confirmed help/docs now mention all new public flags.
- Confirmed `complete-goals` is documented as fallback/resume, not removed.
- Confirmed validation batches are described as stricter review boundaries, not weaker completion gates.
