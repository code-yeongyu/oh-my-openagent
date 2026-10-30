# isolation-core

Harness-neutral filesystem isolation PAL with patch and branch merge-back.
Task-runner integration is supplied by callers.

Provenance: ported from oh-my-pi `crates/pi-iso` + `task/isolation-*`, MIT.
Candidate ordering, unavailable-only fallback and retention follow that upstream.
The owner protocol adds process-instance identity, daemon session ownership and
atomic publication. No Rust/napi crate or `.node` sidecar is required.
ProjFS is excluded: its driver-callback provider API requires a native callback
host, not a Bun-callable clone operation.

## Contract

- Backends write only inside the supplied context base directory. `start` targets
  its `m` child; `stop` must be safe after a partially failed start.
- `IsolationUnavailableError` permits fallback. Other errors propagate. A failed
  teardown preserves the tree rather than recursively removing an active mount.
- `chooseBaseDir(repoRoot, homeDir, id)` selects a same-device location, using a
  mkdir/remove probe for a volume root. Its optional I/O seam is for deterministic
  device tests. A home fallback on another device excludes tree-cloning backends.
- `ensureIsolation` claims a unique `.creating-<pid>` sibling before starting,
  then publishes through the backend's optional `relocate(fromBase, toBase)` hook,
  or rename for non-mounted backends. Retention uses the same hook. Existing published or in-flight directories are not
  overwritten; use stale sweeping to reclaim dead attempts.
- Ownership is checked before age. Foreign, retained, live and unknown owners
  are never automatically deleted. Creating/malformed markers get a ten-minute
  grace period. A live creating owner survives regardless of age.
- Process identity reuses memory-core's lazily loaded native functions without
  its subprocess fallback. Node returns null and uses PID-only liveness.
- `sweepStaleIsolations(roots, { backends, probe })` stops the recorded backend
  before removal. Without a matching backend implementation it reports a skip;
  without a daemon probe it keeps host-session children as unknown.
- `retainIsolation(handle, reason)` transfers the tree to a retained path and
  invalidates the old handle paths. Manual removal requires stopping its recorded
  backend at `<retainedPath>/m` before recursively removing the retained directory.

- `mergeIsolatedChanges` writes root/nested patches and an isolation summary before
  merging. `apply: false` retains artifacts without mutating the parent. Callers
  own teardown; on artifact-write failure keep the handle and call
  `retainIsolation(handle, reason)` rather than cleaning it up.
- Patch apply is atomic per repository and never automatically uses `--3way`.
  Root failure leaves nested repositories untouched; nested failure after root
  success is reported as partial. Nested changes are committed separately.
- Branch replay preserves child commits on clean baselines and filters inherited
  WIP on dirty baselines. Unresolvable replay throws `IsolationCommitReplayError`
  naming the commit and retained branch (the facade reports branch-merge-failed).
  It does not fall back to committing the user's overlapping WIP.
- Both modes serialize through memory-core's identity-bearing lock in Git's
  common directory, including linked-worktree parents. Branch merges stash WIP
  and restore with `--index`; failed pops preserve the stash and report warnings.
- Low-level `applyDeltaPatch` takes `{ id, artifactsDir }`; `commitToBranch`
  returns `{ branchName, baseSha, nestedPatches }` for `mergeTaskBranch`.

## Verification

Run focused files with `bun test packages/isolation-core/src/<name>.test.ts`.
The package suite is `bun test packages/isolation-core`; typecheck uses
`tsgo --noEmit -p packages/isolation-core/tsconfig.json`.
Tests use fake native/CLI boundaries against actual directories, plus injected
device/liveness probes. `started_at` is an ISO timestamp recorded after successful
start; old `{ backend }` markers remain readable by the sweeper. ZFS markers also
record dataset/snapshot identity, and overlay markers retain the lower path.

The Linux filesystem workflow creates real loopback btrfs and (when the kernel
module loads) ZFS, and exercises publication, COW and teardown. Required check:
`Isolation Linux filesystems / linux-fs` for isolation-core and isolated-child PRs.
Branch protection is not managed by this package; the PR must request that check.
Missing filesystem environment variables produce explicit skip reasons locally.
The workflow also mutation-tests EOPNOTSUPP rejection on the runner's ext4 /tmp.
Reflink's Node-hosted fallback uses argv-only `cp -a --reflink=always`, never a
silent plain copy. FFI walks and rcopy plain copies account bytes during traversal,
reserve 10% headroom, and default to a 2 GiB ceiling (no separate prewalk).

## ReFS manual verification (D2)

Hosted Windows runners do not provide ReFS. The default is native-contract tests
only; do not describe those tests as a live ReFS proof. On a disposable, already
provisioned ReFS volume (for example `R:`), from the repository root in PowerShell:

```powershell
fsutil fsinfo volumeinfo R:
$env:ISOLATION_TEST_REFS_ROOT = 'R:\isolation-tests'
New-Item -ItemType Directory -Force $env:ISOLATION_TEST_REFS_ROOT
bun test packages/isolation-core/src/backends/fs-integration.test.ts -t ReFS
Remove-Item Env:ISOLATION_TEST_REFS_ROOT
```

The test checks publication, aligned extents, unaligned tails, tiny/empty files,
source immutability, and teardown. Native calls use long-path prefixes, allocate
the destination to cluster-rounded EOF, clone its aligned prefix and copy only
the remaining tail, then retain the original logical file size. No volume is
formatted by the test. Save the test output with the Windows build and volume
cluster size when recording a live validation. ProjFS remains intentionally
excluded because its callbacks require a native host, not merely callable FFI.
