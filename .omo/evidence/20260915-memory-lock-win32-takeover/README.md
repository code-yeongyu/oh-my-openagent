# #8294: windows two-process liveness takeover times out at 30 s

Branch `fix/memory-lock-windows-takeover` on `origin/dev` `23c778c5bb`. Plan: `plan.md`.

## Root cause (measured on windows-latest, not inferred)

The lock protocol's Windows process-start fingerprint was read by spawning
`powershell.exe Get-Process` under a 2 s `execFile` budget on every lookup. When PowerShell
start-up crosses that budget the probe is killed and reports null; a null own identity is
deliberately never memoized (#8268), so every `createLockRecord` re-probes and pays the full
2 s. The takeover test runs nineteen sequential commits in its survivor, so the tax alone is
~38 s against a 30 s budget. The issue's red run matches this arithmetic: the two writers of
the first test each paid ~2 s per commit outside the lock (24.3 s observed vs 8.6 s green),
the reflection reservers paid one probe each (3.5 s vs 1.3 s), and the survivor never finished.

The hypothesis in the issue (H1: `exit` fires while `process.kill(pid, 0)` still answers alive)
was tested directly and does not hold on Bun: `process.kill` is `uv_kill`, which answers
`ESRCH` from `GetExitCodeProcess` the moment the process object is signalled - the same event
libuv turns into `exit`. Measured 16/16 SIGKILLed children: `dead` at 0.00-0.01 ms after `exit`.

Bun's `fs.rm` accepts `maxRetries`/`retryDelay` but never retries (bun-v1.4.2
`src/runtime/node/node_fs.rs`: parsed at `args::Rm`, unused by `rm`), so the teardown option
the fixture relied on was a no-op (issue H3 confirmed at source level).

## WHAT WAS TESTED / WHAT WAS OBSERVED

1. `win32-baseline-diagnostic.txt` - windows-latest, dev + temporary diagnostic test (scratch
   branch, never merged). Liveness after `exit`: `dead` immediately, 8/8. PowerShell foreign
   probe: 2014 ms -> null (cold start already over budget on an idle runner), 1293 ms, then
   ~270 ms warm. Own-pid record: 274 ms then 0 ms (memoized). Existing takeover test: 14.2 s.
2. `win32-red-injected-powershell-stall.txt` - same diagnostic with `Start-Sleep -Seconds 3`
   injected into the PowerShell probe (the loaded-runner regime). Every probe 2014-2019 ms and
   null, every `createLockRecord` 2 s with `process_start: "unavailable"`. Two-process file:
   first test 27.7 s, reflection test 10.4 s, takeover test **timed out after 30000 ms** with
   `killed 1 dangling process` - the issue's failure, reproduced on demand.
3. `win32-green-fix-under-injected-stall.txt` - the fix with the SAME stall still injected.
   Foreign probe 0-1 ms, own record 5 ms then 0 ms, identities `win32-creation-filetime:<u64>`.
   Two-process file: 6.8 s / 0.25 s / **6.4 s**. PowerShell is out of the path entirely.
4. `win32-green-soak-x10.txt` - fixed `two-process.test.ts` x 10 on windows-latest: 30/30 pass,
   takeover test 6.16-6.68 s (dev idle baseline 14.2 s).
5. `posix-gate-mengmotaMac.txt` - `bun test packages/memory-core/src/concurrency
   packages/memory-core/src/locks` (51 pass / 4 win32-only skips / 0 fail) and
   `bun test packages/memory-core` (886 pass / 4 skip / 0 fail) at `27b1e65188` on macOS arm64.
6. `bunx tsgo --noEmit -p packages/memory-core/tsconfig.json`: clean.
7. Bundles rebuilt in a linux/amd64 container (node:24-bookworm-slim, bun 1.4.2, clone of the
   pushed branch): `build-extension.mjs --check` and `build-install.mjs --check` report current;
   only the three bundles embedding memory-core changed, the other three are byte-identical.
8. Final-head CI: three consecutive green `test (windows-latest, 1/2)` attempts are linked from
   the PR description and the closing issue comment (they exist only after this commit).

## WHY IT IS ENOUGH

The failure is reproduced deterministically by the one mechanism the fix removes, and the fix
passes under that same fault. The new win32 unit tests pin the kernel32 reader against the
PowerShell oracle it replaces (`StartTime.ToFileTimeUtc()` equality), the spawn instant, and
dead/invalid pids. The takeover test now gates recovery on `isLockOwnerProvenDead`, fails loud
when a child dies before its awaited line, and bounds fixture removal itself. Foreign pids stay
uncached, no timeout was raised, nothing skipped or retried, no assertion loosened.

## WHAT WAS OMITTED

Raw CI logs are reduced to the `DIAG` lines and test result lines; they contain no secrets.
The temporary diagnostic test and the fault-injection commit live only on scratch branches
`diag/8294-*`, deleted after the merge.
