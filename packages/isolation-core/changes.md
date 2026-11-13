# isolation-core changes

## The isolation PAL

Harness-neutral copy-on-write task isolation with patch and branch merge-back,
ported from oh-my-pi `crates/pi-iso` and `task/isolation-*` (MIT). Candidate
ordering, unavailable-only fallback and retention follow that upstream. The
owner protocol adds process-instance identity, daemon session ownership and
atomic publication. No Rust/napi crate and no `.node` sidecar; ProjFS stays
excluded because its driver-callback provider API needs a native callback
host, not a Bun-callable clone operation.

## Backends

APFS clonefile goes through lazy `bun:ffi` with immediate errno
classification, no-follow flags and same-device checks. rcopy builds a git
worktree and detaches its Git metadata into private storage: allowlisted
config, refs and index, alternates, lock removal, guarded admin
deletion and pruning, and nested submodule repair or refusal. btrfs and ZFS
clones record dataset and snapshot identity, fuse-overlayfs keeps the lower
path, and ReFS block-clones cluster-rounded tails on Windows. Copy walks
enforce a 2 GiB default budget with 10% target-space headroom; special
entries are skipped rather than copied.
The sandbox base directory never lands inside the repository being
isolated, even when a subvolume-style root reports its own device; the device
walk adopts the enclosing writable filesystem and otherwise falls back home.
Probing is context-bound: reflink writes its probe files inside the supplied
base directory only, and a probe without a context stays read-only instead of
writing into the source repository. Unexpected backend command failures (an
I/O error from btrfs, zfs or fsutil, a dlopen crash, a live worktree
registration that refuses removal) propagate instead of being reported as
"unavailable"; only capability failures fall through to the next backend.

## Baselines and deltas

Root and nested baselines capture staged, unstaged and non-ignored untracked
state under a default 1 GiB per-repository budget with a typed overflow
error. Git output is drained under the remaining budget and untracked sizes
are checked before rendering. Synthetic indexes reconstruct baseline and
current trees in the source object database, so binary tree diffs exclude
parent WIP and include child commits plus remaining edits. C-quoted UTF-8
paths are decoded before use.

## Merge-back

Patch apply is atomic per repository, probes reverse and forward idempotence,
and never uses `--3way` automatically; nested repositories commit
separately and partial root success is reported explicitly. Branch replay
preserves child commits on clean baselines and filters inherited WIP on dirty
ones; an unresolvable replay throws `IsolationCommitReplayError` naming the
commit and the retained branch. Every failure path retains the isolated tree
with the manual recovery command instead of deleting it. Both modes serialize
through memory-core's identity-bearing lock. Stash cycles
are tracked by entry identity: a no-op push (dirt only inside a submodule)
never touches the stack, and a pop restores exactly the entry the merge
created, never whatever landed on top afterwards. A baseline-listed nested
repository missing from the isolated tree fails the delta loudly instead of
merging back an empty change, and nested paths are checked for symlink
escapes immediately before mutation.

## CI and tests

Run focused files with `bun test packages/isolation-core/src/<name>.test.ts`;
the package suite is `bun test packages/isolation-core`, and typecheck uses
`tsgo --noEmit -p packages/isolation-core/tsconfig.json`. The Linux filesystem
workflow (`.github/workflows/isolation-linux-fs.yml`) creates real loopback
btrfs and, when the kernel module loads, ZFS pools, then exercises
publication, copy-on-write and teardown. ReFS validation on Windows follows
the runbook in AGENTS.md with `ISOLATION_TEST_REFS_ROOT`.

## Test fixture repositories disable git auto-maintenance

The `repo()` fixture sets `maintenance.auto=false` before committing, so no
`git maintenance run --auto --detach` background process outlives a fixture
command. Tests mutate `.git` directly right after the fixture returns; on macOS
CI the detached maintenance process recreated `.git/objects` between the test's
`rm()` and `symlink()`, failing `detach-git-dir.test.ts` with EEXIST.
`git-fixture.test.ts` pins the invariant through `GIT_TRACE`.

## The windows-latest suite runs the full contract set

23 tests failed on the dev full-matrix `windows-latest` 2/2 shard because
PR CI never exercises the OS (see #8604). Three production defects are fixed:

- `runGit`'s win32 teardown now terminates the whole spawned tree with
  `taskkill /T /F` instead of only the direct git child. Windows has no
  process groups, so alias-shell grandchildren (`!` commands) survived the
  kill, kept the drained pipes open and held their working directory —
  the budget-breach tests failed with EBUSY on fixture teardown and the
  orphaned writers lingered for the rest of the shard.
- `detachGitDir`'s canonical path resolution uses the native resolver, which
  expands Windows 8.3 short names (`RUNNER~1`). The JS resolver leaves them
  alone, so the worktree back-pointer identity check never matched and the
  registration survived detach — the ensure retry then hit `git worktree add`
  failing 128 with "missing but already registered worktree". This affects
  any user whose temp or home path carries a short-name component.
- `ZfsBackend.probe` reports an explicit `zfs requires Linux` reason on other
  platforms, matching the btrfs/reflink/overlayfs platform gates, instead of
  failing the dataset parse against foreign path forms.

The remaining failures were fixture and assertion assumptions: Linux-only
CLI contract tests (`platform.test.ts` zfs/overlay) now run against
POSIX-form roots with expectations mirroring production's own `join`
derivations; `base-dir`/`ensure`/`reflink-context`/`detach-git-dir`
expectations compare resolved platform forms (`basename`, `isAtOrBelow`, the
native-resolved forward-slash spelling git prints); filenames that NTFS
forbids (`"`, control characters) stay on filesystems that permit them; the
nested-repository fixture pins `core.autocrlf=false` like the shared `repo()`
fixture; and the signal-death test accepts win32's non-zero-exit form of a
forced kill. No test is skipped without an explicit platform reason.

## A dead git settles its run without waiting out pipe-holding survivors

`runGit` keyed its whole settle on the child `close` event, which Node emits
only after every stdio pipe closes — and git's `!` alias shells inherit those
pipes. When git itself died first, the run stayed pending until the last
survivor exited. The windows-latest flake (#8663) is the kill race: win32
`process.kill(pid, "SIGKILL")` is TerminateProcess with no tree semantics,
git.exe → sh.exe → sleep.exe startup is slow enough under load for the alias
shell to exist when the kill lands, and the surviving shell then held all
three handles (pinning `close` for the alias's full lifetime) and its working
directory (surfacing as EBUSY on fixture teardown). POSIX kills land before
git ever spawns the shell, so only win32 surfaced it.

A child that exits to a signal death or a disallowed code has already failed,
so the run now settles at `exit`: killTree runs immediately — and no longer
refuses to act once the direct child exited, letting the POSIX group kill
reach survivors after their leader died — and if the pipes have not closed by
the end of a one-second drain grace they are force-closed, with the streams'
collectors settling on what was kept. Normal runs are untouched (`close`
follows `exit` in milliseconds for them); win32, where taskkill cannot
enumerate a dead pid's tree at all, is exactly the case the grace covers.
The kill fixture bounds its alias at five seconds so an orphan tail stays
inside the fixture teardown's new EBUSY retry window (`rm` with
`maxRetries`/`retryDelay`, the #8610 family), and the test file pins the
contract with a deterministic survivor: a child that exits failing while an
alias-shell survivor holds its pipes must settle promptly, not wait the
survivor out.
