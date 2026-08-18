# Windows QA attempt and cleanup

## What was tested

The Parallels `Windows 11` VM was started from its original stopped state.
The task test file was staged in a detached remote Mac worktree exposed to the
guest through the Parallels `\\Mac\Home` share.

Three direct guest execution paths were attempted:

1. Guest SSH: failed because SSH readiness flapped after boot.
2. `prlctl exec --current-user` with PowerShell: `bun.ps1` was blocked by the
   guest execution policy before tests started.
3. `prlctl exec --current-user` with `bun.cmd`: PowerShell/cmd could not retain
   the UNC share as the current directory, so Bun searched `C:\Windows`.

## What was observed

No test assertion ran or failed in these attempts. The direct VM lane was
therefore recorded as inconclusive, not PASS.

The faithful Windows proof remains the repository's required
`test (windows-latest)` GitHub Actions job. The RED run failed only because this
file used Bun's 5000 ms default. The PR run must pass that exact job before
merge.

## Why this is enough

The local proof covers source correctness and adjacent regressions. The PR gate
will execute the same full root suite on GitHub's native `windows-latest`
runner, which is the exact surface that failed and the authoritative proof for
this CI-only correction.

## Cleanup receipt

```text
Windows 11 VM: restored to stopped
Remote QA worktree: removed
Temporary .cmd QA script: removed with worktree
Local main checkout: clean
Task worktree: only git-helpers.test.ts changed
```

No background guest command remained running because every failed invocation
exited before test execution.
