# Todo 4 Category Resolver Repair 4 Test Split

worktree: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-category`
starting head: `48aee7db9 fix(senpi-task): harden category model boundary parsing`
base: `27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4`

## Baseline Before Edits

- Invocation: `bun test packages/senpi-task/src/category`
- Surface: category resolver test suite before splitting.
- Binary observable: exit `0`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair4-test-split/baseline-category-tests.log`
- Exit artifact: `.omo/evidence/senpi-task/task-4-category/repair4-test-split/baseline-category-tests.exit`
- Observed: 16 pass, 0 fail, 1 snapshot across 1 file.

Before LOC defect:

- Invocation: pure LOC check over `packages/senpi-task/src/category/*.ts`, `packages/senpi-task/scripts/manual-category-qa.ts`, and `packages/senpi-task/src/index.ts`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair4-test-split/baseline-loc.log`
- Observed: `resolve-category.test.ts` was 281 pure LOC, exceeding the 250 pure-LOC ceiling.

## Split Summary

- Moved registry/model-boundary and prototype-shaped category-name tests from `resolve-category.test.ts` to new co-located `resolve-category-boundary.test.ts`.
- Duplicated only the tiny local fake model registry fixtures needed by the moved tests.
- Left resolver behavior assertions, test names, Given/When/Then structure, and the builtin category snapshot behavior unchanged.
- No production code was changed.

## Verification After Split

Focused category suite:

- Invocation: `bun test packages/senpi-task/src/category`
- Binary observable: exit `0`.
- Artifacts: `01-category-tests.log`, `01-category-tests.exit`
- Observed: 16 pass, 0 fail, 1 snapshot across 2 files.

Package regression suite:

- Invocation: `bun test packages/senpi-task --bail`
- Binary observable: exit `0`.
- Artifacts: `02-senpi-task-bail.log`, `02-senpi-task-bail.exit`
- Observed: 45 pass, 0 fail, 1 snapshot across 9 files.

Type and no-excuse gates:

- Invocation: `bun run typecheck`
- Binary observable: exit `0`.
- Artifacts: `03-typecheck.log`, `03-typecheck.exit`
- Observed: root `tsgo --noEmit`, script typecheck, and package project references completed.

- Invocation: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts`
- Binary observable: exit `0`.
- Artifacts: `04-no-excuse-ts-guard.log`, `04-no-excuse-ts-guard.exit`
- Observed: `No violations in 13 file(s).`

LOC and diff hygiene:

- Invocation: pure LOC check over `packages/senpi-task/src/category/*.ts`, `packages/senpi-task/scripts/manual-category-qa.ts`, and `packages/senpi-task/src/index.ts`.
- Binary observable: exit `0`.
- Artifacts: `05-loc-check.log`, `05-loc-check.exit`
- Observed: `resolve-category.test.ts` 191 pure LOC; `resolve-category-boundary.test.ts` 118 pure LOC; all checked files at or below 250 pure LOC.

- Invocation: `git diff --check 27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4...HEAD -- packages/senpi-task/src/category packages/senpi-task/src/index.ts packages/senpi-task/scripts/manual-category-qa.ts`
- Binary observable: exit `0`.
- Artifacts: `06-diff-check.log`, `06-diff-check.exit`
- Observed: diff whitespace check passed for the scoped files.

Final evidence hygiene:

- Invocation: zero-byte artifact check under `.omo/evidence/senpi-task/task-4-category/repair4-test-split/`.
- Artifacts: `07-zero-byte-artifact-check.log`, `07-zero-byte-artifact-check.exit`

## Why No Behavior Changed

This repair only moved existing test cases into a narrower co-located test file. The same 16 category tests pass before and after the split, with the same snapshot count and assertion count. The production resolver, package exports, manual QA script, and snapshots were not edited.

## Cleanup

- Evidence is contained under `.omo/evidence/senpi-task/task-4-category/repair4-test-split/`.
- No temp scripts, generated files, or external artifacts were created outside the requested evidence directory.
- No OpenCode or Codex harness QA was run because this change is scoped to `packages/senpi-task` test organization, not `packages/omo-opencode` or `packages/omo-codex`.

## Residual Risk

- `resolver.ts` remains in the warning band at 245 pure LOC from prior work, but it was not touched in this repair and remains below the ceiling.
- The new boundary test file duplicates small fake registry fixtures to avoid production/test-helper extraction; future category test growth should keep the boundary file scoped to adversarial registry/category-name inputs.
