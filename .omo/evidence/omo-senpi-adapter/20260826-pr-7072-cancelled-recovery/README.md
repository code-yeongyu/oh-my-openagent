# PR #7072 cancelled-recovery review QA

## What was tested

- Added a focused steering regression where a running orphan becomes `cancelled` while `recoverHandle` supplies a live handle.
- Ran `bun test packages/senpi-task/src/steering/engine.test.ts`.
- Ran `bun test packages/senpi-task` and `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
- Rebuilt `packages/omo-senpi/plugin/extensions/omo-task.js`.
- Ran the real Senpi task driver with Senpi 2026.8.26 and this worktree's plugin through an isolated wrapper.

## What was observed

- The regression failed before the source fix: expected `not_continuable`, received `revived`.
- After the fix, the focused steering suite passed: 28 pass, 0 fail.
- The senpi-task package suite passed: 1782 pass, 1 platform skip, 0 fail.
- The omo-senpi typecheck passed.
- The live task driver passed every check, including `resume_cancel_not_revived`, `resume_finished_steerable`, `task_output_polling_guard`, and `no_leaked_pids`.
- Isolation passed: `realSenpiUntouched=true`, no attributed or concurrent changed paths, digest unchanged, and nine isolated agent directories / working directories were used.

Sanitized driver result: `verdict.json`.

## Why this is enough

The focused regression proves a cancelled record cannot fall through to terminal revival after handle recovery. The full package tests cover steering and lifecycle invariants, while the real Senpi driver exercises the generated adapter bundle and resume/cancel behavior end to end under isolated state.

## What was omitted

Raw driver stdout/stderr, temporary absolute sandbox paths, process IDs, sandbox tokens, and session/task identifiers were not committed. They are unnecessary for review and may be noisy or high entropy.
