# DoneClaim: backup collision repair

## What Changed

- `packages/omo-config-core/src/writer/writer.test.ts` adds a frozen-clock regression test for two immediate `updateOmoConfig` calls against one existing commented project `omo.jsonc`.
- `packages/omo-config-core/src/writer/writer.ts` writes backups with exclusive file creation and appends a numeric suffix when the timestamped `.bak.<ISO>` candidate already exists.

## What Was Tested

- RED: `bun test packages/omo-config-core/src/writer/writer.test.ts --bail`
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/red-backup-collision-20260706.txt`
- GREEN focused writer/security: `bun test packages/omo-config-core/src/writer --bail`
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/focused-writer-tests-20260706.txt`
- Full package: `bun test packages/omo-config-core --bail`
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/bun-test-omo-config-core-20260706.txt`
- Drift guard: `bun test tests/omo-config-category-drift.test.ts --bail`
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/category-drift-20260706.txt`
- Typecheck: `bun run typecheck`
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/typecheck-20260706.txt`
- Whitespace: `git diff --check code-yeongyu/senpi-task-w0-config-schema...HEAD`
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/diff-check-20260706.txt`
- Static scans for `as any`, TS suppressions, empty catch, and changed-file pure LOC.
  - Artifacts: `.omo/evidence/senpi-task/task-2-config-loader-writer/static-scan-20260706.txt`, `.omo/evidence/senpi-task/task-2-config-loader-writer/loc-scan-20260706.txt`

## Manual QA

- Scenario: public `updateOmoConfig` called twice immediately against the same existing commented project `omo.jsonc` under a fixed timestamp.
- Invocation: `bun --eval` importing `loadOmoConfig` and `updateOmoConfig` from `./packages/omo-config-core/src/index.ts`.
- Binary observable: first backup path is `.bak.2026-07-06T00-00-00-000Z`; second backup path is `.bak.2026-07-06T00-00-00-000Z.1`; both existed before fixture cleanup; current config preserved the comment and loaded `default_concurrency: 3` plus `wait.default_ms: 12000`; cleanup removed the temp root.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-backup-collision-20260706.json`

## Cleanup And Scope

- Product diff/status proof:
  - `.omo/evidence/senpi-task/task-2-config-loader-writer/product-diff-20260706.patch`
  - `.omo/evidence/senpi-task/task-2-config-loader-writer/status-before-commit-20260706.txt`
- Touched product files are limited to `packages/omo-config-core/src/writer/writer.ts` and `packages/omo-config-core/src/writer/writer.test.ts`.
- Evidence is limited to `.omo/evidence/senpi-task/task-2-config-loader-writer/`.

## Residual Risk

- Existing branch diff versus `code-yeongyu/senpi-task-w0-config-schema` already includes broader `omo-config-core` work; this repair only covers the backup collision lane.
- `writer.test.ts` is in the 200-250 pure LOC warning band at 212 LOC. No split was done because the request was a minimal repair.
