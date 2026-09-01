# Repaired-head CI failure analysis

The first repaired-head workflow was run `31925417976`.

## Codex Windows

- Failed job: `95112165293`
- Actual failing test: `packages/omo-codex/src/install/install-codex-git-bash-preflight.test.ts`
- RED: first successful non-Windows installer case timed out at `60016ms`.
- Root cause: the platform-branch assertion used `repoRoot: process.cwd()` and copied the full checkout under Windows suite contention.
- Fix: use `createRepoWithBuiltComponentBins()` with owned teardown; timeout unchanged.
- Local GREEN: focused file completed 6/6 in `744ms`; full Codex gate completed 519/519.

## Senpi Windows

- Failed job: `95112165321`
- RED: first two `/memory` tests timed out at `5016ms`.
- Root cause: Bun 1.3.12 restores its 5-second default between files in a multi-file invocation; Windows timed out during the real Git fixture's initial commit before `/memory` executed.
- Fix: file-local 30-second Windows circuit breaker, preserving 5 seconds elsewhere.
- Local CI-Bun GREEN: the exact two-file invocation completed 9/9 in `1.55s`; full Senpi gate completed 1568/1568.

## Windows console probe

- Failed job: `95112165297`
- RED: the probe exited 1, but the test asserted status before exposing captured stdout, so the deciding payload was hidden.
- Root cause: `MainWindowHandle` was used as a hosted-CI contract and the positive control lacked a fail-sensitive separate-console topology.
- Fix: expose status/signal/error/stdout/stderr on failure; use identical detached positive/negative topology; assert console allocation through Win32 `AttachConsole`; retain `MainWindowHandle` for interactive desktop proof; subscribe before shutdown and await process `close`.

## Later current-head validation rounds

- `31927904705`: Windows Codex full-checkout fixture timeout and Windows memory 5-second fixture timeout were root-fixed.
- `31930067950`: macOS concurrent `git worktree add` registration race was fixed with a per-repository administration queue and deterministic overlap test.
- `31931659970`: Windows production driver no longer skipped; `PATHEXT` and the repository-local `node_modules/.bin` directory are resolved explicitly.
- `31932110216`:
  - console host RED: `AllocConsole failed: 5`, meaning the host already had the required console;
  - production route GREEN: `wiringFixed: true`, PID `1084`, and zero leaks;
  - child RED: Bun fs-event assertion caused by an 8.3 sandbox root (`RUNNER~1`) mixed with canonical paths.
- Current code fixes:
  - Win32 error 5 is accepted as an already-attached console;
  - the QA sandbox root is normalized once with `realpathSync.native`;
  - every derived cwd/agent/XDG/home/trust path uses that canonical root.

## Final Windows proof rounds

- `31933958600`: both children inherited the explicit host console, so console attachment was not a visibility oracle.
- `31935960840`: `CreateNoWindow` produced a windowless console object inherited by both children.
- Root fix:
  - the Bun probe parent calls Win32 `FreeConsole`;
  - the visible control must expose a non-zero, visible console HWND;
  - the hidden child must expose no visible console HWND and `MainWindowHandle: 0`;
  - direct stdout emits the raw payload even when the test passes.
- `31938387966`: the console and routing proofs passed, but an unrelated Git-backed cache test hit the default 5-second Windows timeout.
- Root fix: every Git-backed `MemoryBlockCache` test now uses the existing 20-second Windows integration budget.
- `31939507552`: every CI job passed on head `effcfe82e7774c5b6458696bc17853a3dfe49d27`.
