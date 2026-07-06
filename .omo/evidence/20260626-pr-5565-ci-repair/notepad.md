# PR 5565 CI Repair Notepad

Started: 2026-06-26
Objective: Fix PR #5565 so it is rebased onto `origin/dev`, no longer fails the Windows `withLock serializes concurrent work` test, is force-pushed with lease, and has current CI/mergeability reported.

## Skills
- `smart-rebase`: required by user for base detection, rebase, verification, and authorized force-push.
- `github:gh-fix-ci`: PR is blocked by GitHub Actions; use GitHub/gh metadata and logs before implementing.
- `omo:debugging`: the failing check is an async/concurrency test failure.
- `commit`: required if a repair commit is created.

## Tier
HEAVY. The change touches concurrency/locking behavior and required PR CI, so evidence, red/green proof, and reviewer pass are required.

## Success Criteria
- PR branch is rebased onto current `origin/dev` with conflicts resolved or explicitly absent.
- Windows-only `withLock serializes concurrent work` failure has a narrow root-cause fix or non-weakening test repair.
- Focused local verification passes, including red -> green evidence for the failing test.
- Branch is pushed to `code-yeongyu/fix-shared-skills-release-blockers` with `--force-with-lease`.
- GitHub CI status and PR mergeability are checked after push.

## Scenario
- Channel: CLI/test runner.
- Failing-first command: `bun test packages/team-core/src/team-state-store/locks.test.ts -t "withLock serializes concurrent work"`.
- Binary observable: fails before fix under the simulated Windows lock timing condition and passes after fix.
- Real-surface command: rerun the focused Bun test and PR GitHub Actions checks after push.

## Evidence Index
- `pr-checks-before-fix.json`: PR #5565 baseline showing `test (windows-latest)` failed on run `28162375847`, job `83405801286`, head `ee61dcb51`.
- `windows-job-83405801286.log`: focused failed Windows job excerpt. Relevant line: `EPERM: operation not permitted, open ... locks-serialize-...\\lock` at `packages\\team-core\\src\\team-state-store\\locks.ts:84`.
- `red-eperm-access-probe-after-install.txt`: RED proof. New regression test rejected when `access(lockPath)` also returned `EPERM`.
- `green-eperm-access-probe.txt`: GREEN proof for the regression after the classifier fix.
- `green-withlock-focused.txt`: original focused `withLock serializes concurrent work` test passed after the fix.
- `team-core-locks-test.txt`: full `locks.test.ts` passed, 7 pass / 0 fail.
- `team-core-state-store-tests.txt`: `team-state-store` suite passed, 28 pass / 0 fail.
- `team-core-typecheck.txt`: `bun run --cwd packages/team-core typecheck` exited 0.
- `team-core-test.txt`: package test script passed, 146 pass / 0 fail / 1 skip.
- `git-diff-check.txt`: `git diff --check` exited 0.
- `team-core-locks-rerun-each-20.txt`: race-focused repeat run passed, 40 pass / 0 fail.
- `pure-loc.txt`: changed TS files are below the 250 pure LOC ceiling.

## Findings
- Rebase base: `origin/dev` at `1d10b8b4f`; rebase completed with no conflicts.
- Root cause: Windows can return `EPERM` while probing a contended lock path. The old helper treated every failed `access(lockPath)` as absence, so `assertRetryableLockOpenError` rethrew instead of retrying.
- Fix: `pathMayExist` now treats only definite absence (`ENOENT`, `ENOTDIR`) as missing; access-denied probes remain possible contention and retry through the existing bounded lock loop.

## Self-Review
- Single responsibility: changed files own team-state-store locking and its tests.
- Boundary purity: no new external input boundary.
- Variant discrimination: no tagged union discrimination added.
- Escape hatches: no `any`, `as`, non-null assertion, or TS suppressions added.
- Defensive layer: the retry classification handles an observed Windows filesystem state, not speculative null checking.
- Helpers: `pathMayExist` and `isPathAbsenceError` separate the existing existence check semantics now needed by both production and regression test injection.
- Tests: reverting the production change makes `lock open treats EPERM access probes as possible contention` fail.
- Parameter bloat: modified function has three parameters, with related test dependency injection grouped into a typed options object.
- Redundant verification: no destructive-action post-check added to production code.
