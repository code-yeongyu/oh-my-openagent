# Windows memory CI root-fix evidence

## Scope

Base: `origin/dev` at `4acee96c990132e2f40c566a0930f138de934e8e`.
Failing Windows baseline: <https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31576880954/job/94050885506>.

The full failed-job log was downloaded through the GitHub Actions job-log API and inspected cluster by cluster before editing.

## Root causes and fixes

1. **Facts rollback and recovery**
   - Windows does not provide stable POSIX worktree permission bits. A file materialized with the recorded `0644` identity can be recaptured with Windows' synthetic mode, so the compare-and-set transaction rejects its own bytes as foreign. This left the failed-commit test's new file behind and made partial recovery report `parent_dirty`.
   - `GitPathStateStore` now canonicalizes Windows regular-file worktree identity to `0644`, while POSIX keeps exact mode behavior.
   - The deletion-reservation race test accepts Windows' `EEXIST` spelling for writing to the reserved directory, then performs the same foreign-write injection and ownership assertions.

2. **Run terminal claims and downstream reconciliation**
   - Creating an exclusive terminal claim succeeded on Windows, but the following directory `fsync` raised `EPERM`. That turned successful publication/abandonment arbitration into unhandled errors and broke terminal-claim, reconciliation, precedence, runner, and downstream dream/facts tests.
   - Directory-sync now treats Windows `EPERM`/`EACCES`/`EINVAL` during `fsync` as an unsupported directory durability primitive, matching the existing Windows handling for opening directories and other atomic artifact writers. File data is still synced before publication.

3. **Supervisor outcomes and 60-second hangs**
   - At the graceful deadline, both the bootstrap and the supervisor independently enforced termination. On the Windows branch the supervisor called `bootstrap.kill()`, killing the wrapper that owns child-exit observation and `outcome.json`; the model child could remain running and tests waited to their 60-second ceilings.
   - The Windows supervisor now records its graceful deadline but leaves graceful model termination to the bootstrap. The hard deadline still uses tree termination, and abrupt-supervisor bootstrap self-enforcement remains covered. POSIX process-group behavior is unchanged.

4. **Cache stress timeout**
   - The bounded-cache test performs 100 real Git HEAD probes and completed correctly just beyond the generic 5-second Windows ceiling (~5.03s in CI). It now uses the file's existing 20-second Windows integration budget. Assertions and iteration count are unchanged.

## Verification performed

- `npx -y bun@1.3.12 install` - CI-exact Bun dependency install.
- `npx -y bun@1.3.12 test packages/memory-core` - **481 pass, 0 fail** (`memory-core-test.log`).
- `npx -y bun@1.3.12 test packages/omo-senpi/src/components/memory` - **490 pass, 0 fail** (`senpi-memory-test.log`).
- `npx -y bun@1.3.12 run test:senpi` - **1392 pass, 0 fail** (`test-senpi.log`).
- `npx -y bun@1.3.12 run typecheck` - passed (`typecheck.log`).
- `npx -y bun@1.3.12 run build` - passed after cleaning local package `node_modules` that two concurrently launched npm-ci build attempts had raced over (`build.log`).
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` - generated extension current (`build-extension.log`).
- Focused supervisor suite included both injected `posix` and `win32` deadline/containment branches: 12 pass, 0 fail.

## Real Windows gate

The PR's `test (windows-latest)` and all other required checks will be linked here after GitHub Actions completes.

## Isolation and omissions

All implementation and verification ran in the dedicated worktree `/Volumes/mengmotaStorage/local-workspaces/omo-wt/st_019ff542-windows-ci`. No live Senpi user state or real harness credentials were read or modified. Raw environment/auth output and GitHub tokens are omitted.
