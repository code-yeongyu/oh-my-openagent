# Review Fix - PR #5906 Todo 2 Gate Failures

## What Was Tested

- RED regression capture before production edits:
  - `bun test packages/omo-config-core/src/writer/writer.test.ts packages/omo-config-core/src/loader/loader.test.ts packages/omo-config-core/src/loader/merge.test.ts`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/red-review-fix-all-20260706.txt`
- GREEN focused regression rerun:
  - `bun test packages/omo-config-core/src/writer/writer.test.ts packages/omo-config-core/src/loader/loader.test.ts packages/omo-config-core/src/loader/merge.test.ts`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-focused-review-fix-20260706.txt`
- Required automated gates:
  - `bun test packages/omo-config-core --bail`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-omo-config-core-review-fix-20260706.txt`
  - `bun test tests/omo-config-category-drift.test.ts --bail`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-category-drift-review-fix-20260706.txt`
  - `bun run typecheck`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/typecheck-review-fix-20260706.txt`
  - `git diff --check code-yeongyu/senpi-task-w0-config-schema...HEAD`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/diff-check-review-fix-20260706.txt`
- Manual QA through the real package API:
  - `bun --eval "$(cat .omo/evidence/senpi-task/task-2-config-loader-writer/manual-qa-eval-script.mjs)"`
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-qa-review-fix-20260706.txt`
  - Cleanup receipt:
    - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/cleanup-receipt-review-fix-20260706.txt`

## What Was Observed

- RED evidence reproduced all three review blockers:
  - malformed existing `.omo/omo.jsonc` did not throw before the fix;
  - nested unsafe keys survived under a newly assigned merged object;
  - user `$XDG_CONFIG_HOME/omo/omo.json` was ignored.
- GREEN package test evidence passed with `11 pass, 0 fail`.
- Category drift guard passed with `1 pass, 0 fail`.
- Typecheck exited `0`.
- Diff whitespace check exited `0`.
- Manual QA observed:
  - user `omo.json` loaded from the XDG user config path with `default_concurrency: 11`;
  - malformed writer threw `OmoConfigWriteError` with operation `parse`, left original bytes unchanged, and left no temp file;
  - nested unsafe own keys were stripped and `Object.prototype` was not polluted.
- Cleanup receipt showed no remaining manual fixture run directories.

## Why It Is Enough

- The unit regressions lock the exact broken seams named by the reviewer: user path detection, recursive merge sanitization, and malformed writer preflight.
- The required package, drift, typecheck, and diff-check gates cover the affected package and the category parity boundary.
- The manual `bun --eval` run imports the real public package API from the worktree and drives the three repaired behaviors against fresh evidence-local fixture directories.

## What Was Omitted

- No OpenCode or Codex harness QA was run because this repair stayed inside `packages/omo-config-core/**` and does not touch adapter config pipelines.
- No real home or user config paths were written; all manual fixtures were created under `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-fixtures/` and removed during the run.
- No secret-bearing logs, environment dumps, tokens, or auth headers were captured.
