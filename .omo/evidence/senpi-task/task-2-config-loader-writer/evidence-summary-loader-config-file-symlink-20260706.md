# Evidence Summary: Loader Project Config File Symlink Repair

Date: 2026-07-06
Worktree: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-config-loader-writer`
Branch: `code-yeongyu/senpi-task-w0-config-loader-writer`

## What Changed

- `packages/omo-config-core/src/loader/paths.ts`: project config discovery now ignores symlinked project config files before `loadOmoConfig()` can read them.
- `packages/omo-config-core/src/loader/loader.test.ts`: added RED/GREEN coverage for a real project `.omo` directory containing `omo.jsonc` and `omo.json` symlinks to outside files.
- Chosen behavior: ignore symlinked project config files without diagnostics, matching the existing symlinked project `.omo` directory behavior.

## Required Scenarios And Artifacts

### RED: project config file symlink was previously applied

- Scenario: `project/.omo` is a real directory; `project/.omo/omo.jsonc` is a symlink to an outside file with `task.default_concurrency: 9`.
- Invocation: `bun test packages/omo-config-core/src/loader/loader.test.ts --bail --test-name-pattern "symlinked project omo json"`
- Binary observable: exit code `1`; assertion expected default `5` but received `9`.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/red-loader-project-config-file-symlink-20260706.txt`

### GREEN: project config file symlinks ignored

- Scenario: same as RED, plus shared-path coverage for `project/.omo/omo.json`.
- Invocation: `bun test packages/omo-config-core/src/loader/loader.test.ts --bail --test-name-pattern "symlinked project omo json"`
- Binary observable: exit code `0`; `2 pass`, `0 fail`; both `.jsonc` and `.json` symlinked project config files left `task.default_concurrency` at default `5` and loaded no project source.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-loader-project-config-file-symlink-20260706.txt`

### Preserved directory-symlink regression

- Scenario: `project/.omo` is itself a symlink to an outside directory containing `omo.jsonc`.
- Invocation: `bun test packages/omo-config-core/src/loader/loader.test.ts --bail --test-name-pattern "symlinked project omo directory"`
- Binary observable: exit code `0`; `1 pass`, `0 fail`; target config ignored.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-loader-project-omo-directory-symlink-20260706.txt`

### Preserved same-key teams partial merge

- Scenario: user config defines `teams.alpha.members`; project config defines `teams.alpha.description`.
- Invocation: `bun test packages/omo-config-core/src/loader/loader.test.ts --bail --test-name-pattern "same-key partial team layers"`
- Binary observable: exit code `0`; `1 pass`, `0 fail`; description and member both present.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-loader-same-key-teams-merge-20260706.txt`

### Package gate

- Scenario: full `omo-config-core` suite after loader repair.
- Invocation: `bun test packages/omo-config-core --bail`
- Binary observable: exit code `0`; `22 pass`, `0 fail`.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-bun-test-omo-config-core-bail-20260706.txt`

### Category drift guard

- Scenario: config-core category schema parity with omo-opencode category schema.
- Invocation: `bun test tests/omo-config-category-drift.test.ts --bail`
- Binary observable: exit code `0`; `1 pass`, `0 fail`.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-bun-test-omo-config-category-drift-bail-20260706.txt`

### Typecheck

- Scenario: repo TypeScript typecheck after loader repair.
- Invocation: `bun run typecheck`
- Binary observable: exit code `0`.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-bun-run-typecheck-20260706.txt`

### Diff whitespace/range check

- Scenario: requested schema-base diff check.
- Invocation: `git diff --check origin/code-yeongyu/senpi-task-w0-config-schema...HEAD`
- Binary observable: exit code `0`.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-git-diff-check-schema-base-20260706.txt`

### Manual public API fixture probe

- Scenario: direct `loadOmoConfig()` public API probe with real temp fixtures.
- Invocation: `bun .omo/evidence/senpi-task/task-2-config-loader-writer/manual-public-api-fixture-probe-20260706.mjs`
- Binary observable: exit code `0`; assertions passed.
- Proven observations:
  - project config file symlink target not applied: `taskDefaultConcurrency: 5`, `loadedProjectSources: []`
  - project `.omo` directory symlink target not applied: `taskDefaultConcurrency: 5`, `loadedProjectSources: []`
  - normal project config still loads: `taskDefaultConcurrency: 8`, one loaded project source
  - same-key teams partial merge persists: `description: "near layer"`, `firstMemberName: "one"`
  - cleanup removed temp dirs: `cleanupRootsExistAfter: []`
- Artifacts:
  - `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-public-api-fixture-probe-20260706.mjs`
  - `.omo/evidence/senpi-task/task-2-config-loader-writer/manual-public-api-fixture-probe-20260706.txt`

### TypeScript no-excuse and LOC review

- Invocation: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-config-core/src/loader/paths.ts packages/omo-config-core/src/loader/loader.test.ts`
- Binary observable: exit code `0`; no violations.
- Artifact: `.omo/evidence/senpi-task/task-2-config-loader-writer/green-no-excuse-loader-symlink-20260706.txt`
- LOC check:
  - `packages/omo-config-core/src/loader/paths.ts`: 98 pure LOC
  - `packages/omo-config-core/src/loader/loader.test.ts`: 197 pure LOC

## Adversarial Classes

- `malformed_input`: covered by existing loader malformed/unreadable config test in the package gate.
- `stale_state`: avoided with fresh temp fixtures in tests and manual probe; manual probe reports cleanup.
- `dirty_worktree`: checked before work; final status will be rechecked after commit/push.
- `misleading_success_output`: every artifact appends an explicit `EXIT_CODE=...` and the manual probe asserts values before printing success.
- `flaky_tests`: focused tests and package suite use deterministic temp dirs, no sleeps, no wall-clock assertions.
- `hung_or_long_commands`: required commands completed within bounded command invocations; no command was left running.
- `prompt_injection`: not applicable; no LLM/user text is parsed by the config loader in this repair.
- `cancel_resume`: not applicable; no interruption occurred during execution.
- `repeated_interruptions`: not applicable; no repeated interruption occurred.

## Omitted

- No raw secrets, auth headers, launchd environments, or service logs were captured.
- No OpenCode/Codex harness QA was run because the scoped repair is in harness-neutral `packages/omo-config-core` and the task specified loader public API/manual fixture verification.
