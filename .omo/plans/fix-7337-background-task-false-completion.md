# Fix #7337: Reject Outputless Terminal Background Tasks

## Objective

Prevent a background task from entering `completed` when its child session reaches a terminal status without producing assistant or tool output. Preserve successful completion for terminal sessions that do contain output, keep sibling tasks isolated, and report the outputless child as an explicit task error.

## Confirmed Root Cause

`BackgroundManager.pollRunningTasks()` reconciles child-session contents for idle and missing-session paths, but the `isTerminalSessionStatus()` branch calls `tryCompleteTask()` directly. Today the only recognized terminal non-idle status is `interrupted`, so an interrupted child containing only its initiating user prompt bypasses `validateSessionHasOutput()` and is published as `completed`.

## Behavioral Decision

- An `interrupted` child with assistant/tool output may complete as before.
- An `interrupted` child without assistant/tool output becomes `error` through the existing failed-task lifecycle.
- The outputless terminal child is torn down through the existing session cleanup callback so the fix does not orphan a tmux pane.
- Busy siblings remain running and retain their concurrency slots.
- Idle sessions without output continue waiting because idle is recoverable.
- Session message fetch failures are indeterminate and never authorize completion; affected tasks keep waiting under the existing stale/TTL bounds.
- No speculative retry is added because the outputless interruption supplies no provider error that the existing fallback classifier can route.

## Implementation Steps

1. Add a failing regression to `packages/omo-opencode/src/features/background-agent/manager.polling.test.ts` using one parent with an interrupted user-only child and a busy sibling. Assert the child does not complete, becomes an explicit error after the fix, the sibling remains untouched, and child teardown runs exactly once.
2. Capture the red result on the unmodified production branch.
3. Replace boolean output reconciliation with a tri-state result (`output`, `no-output`, `unknown`). Complete only verified output, clean up and fail verified no-output terminal children, and keep indeterminate observations waiting under existing stale/TTL bounds. Guard the failed-task lifecycle against concurrent terminal transitions.
4. Run LSP diagnostics on both changed TypeScript files and the focused polling test.
5. Run the focused polling tests repeatedly, the full background-agent feature suite, package and workspace typechecks, build, diff hygiene checks, and source-hygiene checks.
6. Update `packages/omo-opencode/src/features/background-agent/AGENTS.md` so completion documentation includes terminal-status output reconciliation.
7. Drive real OpenCode in an isolated XDG sandbox. Create real child-session state for a user-only aborted child and a normal output-producing child, then exercise the real `BackgroundManager` polling route. If OpenCode does not expose an observable `interrupted` window or aborts before positive content persists, record those lanes as blockers and rely on RED-to-GREEN unit coverage rather than synthesizing a live pass.
8. Record sanitized evidence under `.omo/evidence/20260825-7337-background-false-completion/`, including focused red/green results, type/build/test outputs, real session roles, manager outcomes, and proof that QA session IDs exist only in the sandbox database.
9. Run two independent fresh-session OXA audit-and-fix passes, resolve every valid finding with RED-to-GREEN coverage, and repeat affected tests and QA after any behavior change.
10. Create atomic semantic commits for implementation/tests, architecture documentation, and QA evidence. Push the task branch, open a PR targeting `dev`, wait for all required CI and Cubic gates, fix any failures without bypasses, then merge with a merge commit.

## Verification Contract

- The regression fails on original HEAD because the user-only child is `completed`.
- The regression passes after the fix with child=`error`, sibling=`running`, and teardown count=1.
- Existing interrupted-with-output coverage continues to pass with `completed`.
- Diagnostics are clean on changed TypeScript files.
- Focused, feature-wide, package typecheck, full typecheck, root tests, and build pass, or an unrelated pre-existing blocker is identified with exact evidence.
- Real OpenCode QA runs only under isolated XDG paths and leaves no QA session IDs in the real session database.
- The PR targets `dev`, all active gates pass, and merge method is `merge`, never squash/rebase/admin override.
