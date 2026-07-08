# Loader Symlink Discovery Final4 Evidence - 2026-07-06

## What Was Tested

- RED focused regression: `bun test packages/omo-config-core/src/loader/loader.test.ts --bail --test-name-pattern "symlinked project omo directory"` before the loader fix.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/red-loader-project-omo-symlink-20260706.txt`
- GREEN focused regression: same command after the loader fix.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-loader-project-omo-symlink-20260706.txt`
- Full package gate: `bun test packages/omo-config-core --bail`.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/test-omo-config-core-bail-20260706.txt`
- Category drift gate: `bun test tests/omo-config-category-drift.test.ts --bail`.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/test-omo-config-category-drift-bail-20260706.txt`
- Type gate: `bun run typecheck`.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/typecheck-loader-symlink-final4-20260706.txt`
- Whitespace gate: `git diff --check origin/code-yeongyu/senpi-task-w0-config-schema...HEAD`.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/diff-check-schema-base-20260706.txt`
- Same-key partial teams merge proof: `bun test packages/omo-config-core/src/loader/loader.test.ts --bail --test-name-pattern "same-key partial team layers"`.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-teams-partial-merge-focused-20260706.txt`
- TypeScript no-excuse scan on changed TS files.
  - Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/no-excuse-loader-ts-20260706.txt`
- Manual public API fixture probe: `bun .omo/evidence/senpi-task/task-2-config-loader-writer/manual-public-api-fixture-probe-20260706.mjs`.
  - Output artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-public-api-fixture-probe-20260706.txt`
  - Probe script: `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-public-api-fixture-probe-20260706.mjs`

## What Was Observed

- RED artifact observed the original blocker: expected `task.default_concurrency` default `5`, received `9` from the outside symlink target.
- GREEN focused artifact observed `1 pass`, `0 fail`, and the symlinked project `.omo` target was not loaded.
- Full `omo-config-core` package gate observed `20 pass`, `0 fail`, `90 expect() calls`.
- Category drift gate observed `1 pass`, `0 fail`.
- Typecheck exited 0 across root, script, and package `tsgo --noEmit` invocations.
- Diff check exited 0.
- Same-key partial teams merge focused test observed `1 pass`, preserving the prior final3 repair.
- Manual probe observed:
  - `symlinkedProjectOmo.taskDefaultConcurrency: 5`, `diagnostics: []`, and `loadedProjectSources: []`.
  - `normalProjectOmo.taskDefaultConcurrency: 7` with a loaded regular project `.omo/omo.jsonc` source.
  - `sameKeyTeamPartialMerge.alpha` preserved both `members[0].name: "one"` and `description: "near layer description"`.
  - `cleanup.fixtureRootExistsAfterCleanup: false`.

## Why It Is Enough

The failing-first test toggles the exact final4 failure class: a project `.omo` symlink to an outside directory containing `omo.jsonc` with `task.default_concurrency: 9`. The fix changes project discovery to inspect the `.omo` directory itself and ignore it when it is a symlink, so the outside target is not treated as trusted project state. The manual probe drives the exported `loadOmoConfig()` API with real filesystem fixtures and separately proves a legitimate project `.omo` still loads.

## What Was Omitted

No OpenCode or Codex harness QA was run because this change is confined to the harness-neutral `packages/omo-config-core` loader surface and does not touch `packages/omo-opencode` or `packages/omo-codex`. No raw secret-bearing logs, auth headers, environment dumps, tokens, or private credentials were captured.
