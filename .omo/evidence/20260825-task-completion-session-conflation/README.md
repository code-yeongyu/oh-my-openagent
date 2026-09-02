# Evidence: Fix #6240 - sync task completion conflates session end with success

## WHAT WAS TESTED

1. Failing-first regression: `bun test packages/omo-opencode/src/tools/delegate-task/sync-completion-message.test.ts packages/omo-opencode/src/tools/delegate-task/sync-result-fetcher.test.ts` with all seven production/test edits stashed (`git stash push -- sync-completion-message.ts sync-continuation.ts sync-result-fetcher.ts sync-session-turns.ts sync-task-runner.ts tools.test.ts sync-result-fetcher.test.ts`). Expected: the new outcome-classification tests fail because both completion builders hardcode "Task completed in ..." regardless of how the child session's final turn ended.
2. Green run after `git stash pop`: same scoped suite plus the full `delegate-task/` directory suite (498 tests across 43 files).
3. Repo type gate: `bun run typecheck` (tsgo root + script + all workspace packages), exit 0.
4. Real-flow probe: standalone driver of `createDelegateTask` execute path with a completed-session mock (`finish: "stop"`, lexicographically ordered message ids) confirming the healthy path still renders "Task completed in ...".

## WHAT WAS OBSERVED

- Failing-first (`tests-failing-first.txt`): 18 pass / 4 fail; failures exactly at the interrupted/failed cases - e.g. `buildSyncTaskCompletion > #given the child session ended mid-turn without a terminal finish (interrupted)` received `"Task completed in 5s. ..."` where the interrupted headline was required. An earlier red run (before any production edit, fetcher assertions included) showed 15 fail / 11 pass across both files, pinning the missing `endState` on `fetchSyncResult` ok-results as well.
- Green scoped (`tests-scoped-green.txt`): 26 pass / 0 fail / 41 expect() calls across 2 files.
- Green full delegate-task suite (`tests-delegate-task-suite-green.txt`): 498 pass / 0 fail / 1147 expect() calls across 43 files. Two pre-existing integration fixtures in `tools.test.ts` that modeled a *completed* sync task with a finish-less assistant message were updated to carry `finish: "stop"` plus lexicographically ordered user/assistant ids; their original assertions ("Task completed") are unchanged and now pass through the real classifier instead of the old fallback break path.
- Typecheck: exit 0, no errors.

## WHY IT IS ENOUGH

The regression tests drive the exact seam the issue reports: `buildSyncTaskCompletion` / `buildRecoveredSyncTaskCompletion` (sync-completion-message.ts) rendered success purely because the poll loop observed lifecycle completion, and `fetchSyncResult` returned `{ ok: true }` with no outcome information. The new tests pin all three outcome states at the builder layer and the `endState` propagation at the fetcher layer (terminal finish -> completed; finish-less or non-terminal finish or dangling tool part -> interrupted; errored latest assistant -> failed). The full delegate-task suite proves no consumer of the enriched ok-shape regressed, including the continuation path whose inline templates now use the same classification. Remaining risk: outcome wording is consumed by parent-model prompts rather than machine-parsed contracts; background-task completion messages are a separate surface not covered by this issue's triage scope.

## WHAT WAS OMITTED

- No live multi-session OpenCode drive: the changed seam is fully deterministic over fetched session messages; unit + integration suites cover it without spawning opencode (no XDG-isolation proof needed since no real harness process was started).
- Background task completion wording untouched (issue triage scopes the sync completion wrapper).
- Full-repo `bun test` not re-run beyond the delegate-task suite in this worktree; CI runs it on the PR.
