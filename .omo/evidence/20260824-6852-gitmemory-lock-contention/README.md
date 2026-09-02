# Evidence: fix(memory-core) GitMemoryRepo worktree-add commit loss (#6852)

## WHAT WAS TESTED

1. RED (failing-first): `bun test packages/memory-core/src/git/repo-worktree-add.test.ts`
   with the implementation stashed (`git stash`), proving the new regression tests fail
   against the pre-fix code. Artifact: `red-before-fix.txt` (3 fail / 0 pass; T1+T2 die on
   the verbatim `fatal: failed to read .git/worktrees/checkout-5/commondir: Success`
   GitCommandError, T3 records 1 attempt instead of the 5-attempt budget).
2. GREEN: same file with the fix applied. Artifact: `green-new-tests.txt` (3 pass / 0 fail).
3. Scoped suites: `bun test packages/memory-core/src/git/` -> 62 pass / 0 fail;
   `bun test packages/memory-core/src/` -> 550 pass / 0 fail. Artifact: `scoped-suites.txt`.
4. Typecheck: `bun run --cwd packages/memory-core typecheck` (tsgo --noEmit) -> clean.
   Artifact: `typecheck.txt`.
5. Stress: 20x the issue's concurrency test
   (`repo.test.ts -t "every commit lands"`) and 10x the new test file, all green.
   Artifact: `stress.txt`.

## WHAT WAS OBSERVED

- Root cause chain reproduced deterministically: concurrent `git worktree add` processes
  enumerate `.git/worktrees/` while a sibling registration is mid-creation; git reads a
  `commondir` that exists but is not yet written and aborts the whole add with
  `failed to read .../commondir` plus the platform's errno-0 spelling ("Success" on Linux,
  "Undefined error: 0" on macOS). The error carries no `*.lock` marker, so
  `withGitLockRetry` classified it as permanent and never retried it; the in-process
  `withSerializedGitWorktreeMutation` queue does not span processes. The aborted attempt
  leaves its branch ref behind (verified locally: after a torn add,
  `git branch --list` still shows the branch while no worktree is registered), so even a
  naive retry would die on "branch already exists". Callers such as
  `createReflectionWorktree` propagate the failure and that writer's commit never lands.
- After the fix, `worktreeAdd` retries the race up to 5 times with backoff, probing
  `refs/heads/<branch>` between attempts: if the torn attempt created the branch, the
  retry checks out that existing branch (no `-b`, no duplicate ref); if not, it retries
  with `-b`. Non-race failures and budget exhaustion rethrow the original error loudly.

## WHY IT IS ENOUGH

- The regression tests simulate the exact CI-captured failure signature from issue #6852
  (run 31732452566 stderr) deterministically through an intercepting GitExec - no timing
  luck, satisfying the package rule against timing-based concurrency tests.
- Both partial-state shapes are pinned (branch left behind vs. died before ref creation)
  because the retry must adapt argv differently in each; the exhaustion case pins that the
  error still surfaces loudly instead of being swallowed into a silent skip.
- The issue's own concurrency test passes 20/20 stress runs alongside the new tests
  10/10, and the full memory-core suite (550 tests) stays green, so the change did not
  weaken any existing invariant.

## WHAT WAS OMITTED

- No secrets, tokens, or env dumps are involved in this change surface; raw outputs above
  contain only temp-dir paths under /tmp.
- Cross-process serialization of worktree administration (an OS-level lock spanning
  processes) was considered and deliberately omitted as a larger blast-radius change; the
  retry-with-backoff path recommended by the issue reporter covers the observed failure
  without introducing a new lock domain. Residual risk: a third-party process racing omo's
  worktree mutations can still cost one retry cycle before succeeding.
- The windows-latest ~5s timeout variant (issue comment 5) was not reproduced locally
  (no Windows runner); the retry budget (max ~375ms of backoff) does not add meaningful
  wall clock to that boundary.
