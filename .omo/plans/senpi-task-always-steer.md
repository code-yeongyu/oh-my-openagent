# senpi-task always-steer plan

## Goal

Remove the public `task_send.deliver_as` option and make every plain-text `task_send` request steer semantics, while preserving completed-resident session revival through the engine's internal follow-up mechanism.

## Success criteria

1. Public schema, runtime routing, and call rendering fail before implementation and pass after it.
2. A running child receives an optionless steer through live Senpi RPC QA.
3. A completed resident child revives the same task/session through an optionless direct library call.
4. Tests, Senpi compatibility, typechecks, build, reviewer gate, CI, and merge complete.

## Ordered work

1. Create an isolated worktree from `origin/dev`.
2. Map schema, runtime, renderer, callers, guidance, generated artifacts, and QA scenarios.
3. Capture behavior-specific RED tests.
4. Remove the schema option, force steer in `runTaskSend`, remove obsolete interrupt control variants, and update renderers.
5. Update tests, QA scenarios, docs, skills, usage guidance, and generated artifacts.
6. Capture GREEN tests, live surface evidence, cleanup receipts, package gates, typechecks, and build.
7. Obtain unconditional reviewer approval.
8. Create atomic commits, open the PR, satisfy CI/Cubic, merge with a merge commit, and remove the worktree.

## Evidence

Reviewer-readable artifacts live under `.omo/evidence/20260727-senpi-task-always-steer/`.
