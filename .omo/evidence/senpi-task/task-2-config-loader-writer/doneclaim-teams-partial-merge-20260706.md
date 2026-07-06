# DoneClaim Evidence: teams partial merge repair

## Hypothesis / root cause

Final Gate B failed because `readConfigSource()` validated every individual source layer with `OmoConfigSchema` before merging. That full schema requires `teams.<name>.members`, so a nearer layer containing only `teams.alpha.description` was rejected before `mergeOmoConfigRecords()` could combine it with a farther layer containing `teams.alpha.members`.

The repair adds a source-layer schema that keeps root keys strict and validates present value types, but permits partial `teams.<name>` objects. The final merged object still validates with the full `OmoConfigSchema`, so truly invalid final config remains diagnostic-producing.

## RED / GREEN proof

- RED focused regression: `red-teams-partial-merge-20260706.txt`
  - Invocation: `bun test packages/omo-config-core/src/loader/loader.test.ts -t "same-key partial team layers"`
  - Observable: failed with `Invalid omo config ... teams.alpha.members` on the nearer project layer.
- GREEN focused regression: `green-focused-teams-partial-merge-20260706.txt`
  - Invocation: same focused test.
  - Observable: `1 pass`, `0 fail`, `3 expect() calls`.

## Verification command summary

- `bun test packages/omo-config-core --bail`
  - Artifact: `bun-test-omo-config-core-bail-20260706.txt`
  - Observable: `19 pass`, `0 fail`.
- `bun test tests/omo-config-category-drift.test.ts --bail`
  - Artifact: `bun-test-category-drift-bail-20260706.txt`
  - Observable: `1 pass`, `0 fail`.
- `bun run typecheck`
  - Artifact: `bun-run-typecheck-20260706.txt`
  - Observable: `tsgo --noEmit` package chain exited 0.
- `git diff --check`
  - Artifact: `git-diff-check-working-tree-20260706.txt`
  - Observable: empty output, exit 0.
- `git diff --check origin/code-yeongyu/senpi-task-w0-config-schema...HEAD`
  - Artifact: `git-diff-check-origin-schema-range-20260706.txt`
  - Observable: empty output, exit 0.
- TypeScript no-excuse checker
  - Artifact: `typescript-no-excuse-check-20260706.txt`
  - Observable: `No violations in 4 file(s).`

## Manual public API QA

Artifact: `manual-public-api-qa-20260706.txt`

Invocation: `bun --eval` using `loadOmoConfig` from `packages/omo-config-core/src/index.ts` with temporary fixture directories.

Observed:
- Same-key partial `teams.alpha` merge returned `same_key_merge_diagnostics []`.
- Final config had `same_key_merge_description near layer description`.
- Final config preserved `same_key_merge_member one`.
- Invalid config produced `invalid_diagnostic_kinds validation` and `invalid_issue_paths task.default_concurrency`.
- Temp fixture cleanup returned `invalid_fixture_exists_after_cleanup false` and `merge_fixture_exists_after_cleanup false`.
- Diff/status receipt showed only the intended config-core files plus the evidence patch cleanup before ignored evidence staging.

## Product diff / cleanup receipt

- Whitespace cleanup target: `product-diff-20260706.patch`
- Current scoped product diff artifact: `product-diff-teams-repair-20260706.patch`
- Exact required range whitespace check artifact: `git-diff-check-origin-schema-range-20260706.txt`

## Adversarial classes

- `malformed_input`: covered by invalid `task.default_concurrency` manual QA and existing loader malformed-config test.
- `stale_state`: temp fixtures use fresh `mkdtemp`/PID paths and cleanup receipts prove removal.
- `dirty_worktree`: `manual-public-api-qa-20260706.txt` and pre-commit status reviewed only allowed files/evidence.
- `misleading_success_output`: RED artifact captures the original failure; GREEN/full-suite artifacts capture pass counts.
- `flaky_tests`: focused test, package test, category drift, and typecheck were run as separate invocations.
- `hung_or_long_commands`: all required commands completed with captured output.
- `prompt_injection`: not applicable; no external prompt/content execution path changed.
- `cancel_resume`: not applicable; no interrupted/resumed runtime state was used.
- `repeated_interruptions`: not applicable; this turn had one continuous repair pass.

## Cleanup receipt

No persistent temp fixtures remain from manual QA. No debug statements, temp scripts, or source instrumentation were added. Evidence artifacts are under `.omo/evidence/senpi-task/task-2-config-loader-writer/`.
