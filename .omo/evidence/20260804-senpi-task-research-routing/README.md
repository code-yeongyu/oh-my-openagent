# Senpi Task Research Routing QA

## What was tested

- Built the Senpi extension from this PR worktree with the CI-pinned Bun 1.3.12
  compiler.
- Ran the real Senpi task harness with the repository's local mock provider:

  ```text
  TASK_E2E_OUT_DIR=.omo/evidence/20260804-senpi-task-research-routing/live \
    node packages/omo-senpi/scripts/qa/task-e2e.mjs
  ```

- Ran a Bun driver against `buildTaskToolDescription` with the curated
  librarian available, unavailable, and overridden through project config.
- Ran the focused task-description tests, the full `senpi-task` package suite,
  and package typecheck.

## What was observed

- The rendered task description preferred `subagent_type="librarian"` before
  `category="deep"` and retained that preference when deep was unavailable.
- Disabled librarian and project overrides of its description, prompt, or
  tool rules suppressed all curated routing guidance.
- Project overrides of deep description, prompt append, or tool rules retained
  the librarian preference but suppressed deep escalation. Model-only tuning
  preserved escalation.
- Focused tests: 15 passed, 0 failed, with 41 assertions.
- The full `senpi-task` package suite passed.
- `senpi-task` typecheck exited successfully.
- The live Senpi driver passed all 11 checks, leaked no processes, and attributed
  no writes to the real Senpi agent directory.
- Another concurrently running Senpi session changed its own transcript during
  QA. The driver classified that path separately and still reported
  `real_senpi_untouched: true` for QA-attributed writes.

## Why this is enough

- The test locks the structured preferred and escalation targets.
- The driver proves the actual rendered tool description orders and gates those
  targets correctly.
- The live harness proves the rebuilt extension still registers and executes
  task spawn, wake, continuation, output, batch, sync, and error paths in
  isolated Senpi state.

## What was omitted

- No paid-model routing trial was run. A local mock provider avoided repeating
  the token-spend failure that motivated this change.
- Workspace LSP diagnostics could not initialize because the registered server
  could not find its TypeScript installation. `tsgo --noEmit` succeeded.
- The full build-extension `--check` wrapper could not start because the staged
  LSP runtime manifest was absent. Direct builds and generated-bundle freshness
  checks succeeded.
- Raw stdout and JSONL artifacts were omitted from the commit as noisy
  implementation logs. The reviewer-readable `live/verdict.json` is retained;
  it contains no credentials or authorization headers.
