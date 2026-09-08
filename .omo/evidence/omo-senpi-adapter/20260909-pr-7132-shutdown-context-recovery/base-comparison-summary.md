# Comparison evidence for residual local gate failures

All comparisons used Bun 1.4.1 on the same Windows host with the same Bun and Git POSIX directories prepended to `PATH` where the test requires them.

## Merge-parent comparison

The detached worktree at commit `4e921602d02e92b2c973e57c42ca76bd63ae1d94` was unmodified apart from junctions to the already-installed dependencies. Running the nine corresponding test files produced `92 pass`, `3 skip`, and `7 fail` across `102` tests. The seven failures were the runtime dependency symlink, protected-state symlink, Windows task-RPC, config-watch symlink, init-deep symlink, memory cross-identity symlink, and thread workspace symlink cases. Each symlink case failed at `symlinkSync(...): EPERM`, and the task-RPC JSON reported `wiringFixed: false` with the same process-mode product gap as the recovery head. The status-spend test and all eight supervisor integration tests passed.

The raw merge-parent output is [`mergeparent-comparison.log`](mergeparent-comparison.log). The task-RPC rerun with the exact Bun+Git PATH is [`mergeparent-taskrpc-with-path.log`](mergeparent-taskrpc-with-path.log).

## Current-head rerun of the two uncertain cases

On recovery head `fee304c790c01a4d7a53131cb446dfd8d49e03e4`, the status-spend test and all eight supervisor integration tests passed in a focused run with the same PATH. The raw output is [`current-uncertain-focused-with-path.log`](current-uncertain-focused-with-path.log).

These two cases therefore were not reproducible outside the full-suite run, and their source/test paths have no diff between merge parent `4e921602...` and recovery head `fee304c790...`. They remain reported as full-suite instability requiring separate investigation; no unrelated fix was added to this PR.

## Origin/dev cross-check

The detached `origin/dev` worktree at `adecbcf318ff33a9612996f5fa2994f9e8533707` reproduced the same seven symlink failures. With the exact Bun+Git PATH, its task-RPC test also reported `wiringFixed: false` and failed the same assertion. The raw output is [`base-origin-dev-comparison.log`](base-origin-dev-comparison.log), with the PATH-correct task-RPC result in [`base-origin-dev-taskrpc-with-path.log`](base-origin-dev-taskrpc-with-path.log).
