# PR-C: reflection orphan sweep and no demotion on incomplete cleanup

Issue #8304, sections 4 (orphaned worktrees and branches are never swept) and 5
(cleanup receipt demotes a landed reflection). Branch `fix/reflection-orphan-sweep`,
rebased onto `origin/dev` at `7870f80de` (PR-A merged).

## WHAT WAS TESTED

Every behavior below was captured RED before the production change and GREEN after it.

1. `bun test packages/memory-core/src/reflection/orphan-sweep.test.ts`
   New `listReflectionLeftovers` / `selectReflectionOrphans` / `sweepReflectionOrphans`
   against a real git fixture: a stale registered worktree plus branch with an epoch one hour
   old, a stray `<epoch>-<runId>` directory, a legacy `reflection/run-3` branch, a worktree
   whose run id is in `liveRunIds`, and a fresh worktree one minute old. Plus the pure
   selection policy (grace boundary, legacy `reflection-run-<n>` alias, a registered worktree
   whose directory is gone) and a directory beside the worktrees dir that must stay untouched.
   Captures: `red-orphan-sweep.txt`, `green-orphan-sweep.txt`.

2. `bun test packages/memory-core/src/reflection/worktree.test.ts`
   `finalizeReflectionWorktree` with a `GitExec` seam that returns code 1 for
   `["branch", "-D", ...]` while passing every other argv to the real git: the merge lands, the
   branch survives, and the receipt is incomplete.
   Captures: `red-finalize-keeps-merged.txt`, `green-finalize-keeps-merged.txt`.

3. `bun test packages/omo-senpi/src/components/memory/worker/run-finalization-cleanup.test.ts`
   plus the crash and race suites. The run branch is pinned by a second worktree outside
   `runtime/worktrees` (`git worktree add --force`), which makes `git branch -D` refuse exactly
   as a wedged host does, for a merged run and for a supervisor failure.
   Captures: `red-cleanup-and-record.txt`, `green-cleanup-and-record.txt`.

4. `bun test packages/omo-senpi/src/components/memory/worker/run-reconciliation-sweep.test.ts`
   plus the existing reconciliation suite. A reconciliation fixture whose run is kept alive
   through the liveness seams, with an extra registered worktree one hour old and no run
   directory, and a deferred pass under scheduler contention.
   Captures: `red-reconciliation-sweep.txt`, `green-reconciliation-sweep.txt`.

5. Gates, all after the rebase: `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`,
   `bun test packages/memory-core`, `bun test --timeout 20000 packages/omo-senpi/src/components/memory`,
   `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`,
   `node packages/omo-senpi/plugin/scripts/build-install.mjs --check`.
   Capture: `gates.txt`.

## WHAT WAS OBSERVED

- RED 1: every sweep assertion failed against the no-op skeleton (nothing listed, nothing
  selected, nothing removed).
- RED 2: `expect(result.status).toBe("merged")` received `"failed"` - the pinned demotion.
- RED 3: both finalization paths threw `Reflection cleanup incomplete for run-1`, from
  `run-finalization-git.ts:229` and `run-finalization.ts:193`.
- RED 4: the aged orphan worktree and its branch were still present after the pass.
- GREEN 1: stale worktree and branch, stray directory, and `reflection/run-3` removed; the live
  and the fresh worktree and their branches intact; receipts report one item each.
- GREEN 2: status `merged`, `cleanup` `{ worktreeRemoved: true, branchRemoved: false }`, detail
  contains "Reflection cleanup did not fully complete", and the merged content is in the parent.
- GREEN 3: `merged` settles, `reservation.complete` is called once with `merged`, `final.json`
  is written, `ledger.cleanupIncomplete` is `true`, and the journal cursor advances; the failure
  path publishes `failed` the same way. No throw in either path.
- GREEN 4: the orphan directory and branch are gone, the live run's worktree, branch, and run
  directory are untouched, no `final.json` was written, and exactly one logger warning names the
  discarded worktree. A pass that defers on scheduler contention sweeps nothing.
- Gates: tsgo exit 0; `bun test packages/memory-core` 858 pass / 0 fail; `bun test
  packages/omo-senpi/src/components/memory` 1497 pass / 0 fail; both bundle checks report
  "is current" with exit 0.

## WHY IT IS ENOUGH

The sweep is exercised against a real git repository through the real `GitMemoryRepo` and
`createNodeGitExec`, including registered worktrees, stray directories, and both branch
naming schemes, so the git behavior it depends on (`worktree list --porcelain`,
`for-each-ref`, `worktree prune`, `branch -D`) is proven rather than mocked. The two
protection rules that keep a live run safe (run-id ownership and the grace window) are each
asserted on their own: the reconciliation test expires the grace for every leftover so only
`liveRunIds` can protect the live run. The cleanup contract is driven through the real
finalization entry points with a genuinely undeletable branch, so the assertion covers the
production path and not a stubbed receipt. The committed bundle is verified with the repo's
own `--check`, which rebuilds outside the tree and compares bytes.

Residual risk: the sweep is only as safe as the liveness inputs, so a run that holds a
worktree without a reservation entry and without a run directory for more than the 15 minute
grace would still be reclaimed. That shape is exactly the leak this PR targets, and the run
would be dead by then.

## WHAT WAS OMITTED

- No live `senpi` driver run: this change touches the memory worker's reconciliation and
  finalization internals, which the hermetic suites drive end to end against real git and real
  filesystem state. No prompt, tool, hook, or CLI surface changed.
- `bun run build:senpi-plugin` was NOT used to produce the committed bundle. On this machine
  the full chain emits artifacts that the repo's own `build-extension.mjs --check` rejects as
  `stale-output` (a build through the `bun run` chain differs from the check's out-of-tree
  rebuild, the drift the script's own comment describes). Invoking
  `node packages/omo-senpi/plugin/scripts/build-extension.mjs` directly produces artifacts the
  check accepts, so that is what was committed and verified.
- No secrets, tokens, hostnames, or machine names are recorded here. The production symptom
  described in #8304 was measured on a shared macOS host.
