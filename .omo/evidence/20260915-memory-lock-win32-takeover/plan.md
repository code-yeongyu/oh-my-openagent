# Plan: #8294 windows two-process takeover timeout

Branch `fix/memory-lock-windows-takeover` on top of `origin/dev` (`23c778c5bb`).

## Diagnosis (before any production edit)

1. Read `two-process.test.ts`, `writer-child.ts`, `locks/acquire.ts`, `locks/process-identity.ts`,
   `locks/process-start-time.ts`, `journal/lock.ts`; confirm from bun-v1.4.2 sources that
   `process.kill` on win32 is `uv_kill` (GetExitCodeProcess -> ESRCH once terminated) and that
   `fs.rm` parses but never uses `maxRetries`/`retryDelay` (`src/runtime/node/node_fs.rs`).
2. Scratch branch with a temporary diagnostic test + a `memory-two-process` soak target, run on
   windows-latest through `windows-flake-soak.yml`:
   - baseline (no injection): liveness after `exit`, PowerShell probe latency, own-pid record cost,
     `rm` behaviour while a child holds a file.
   - RED: same diagnostic plus a `Start-Sleep -Seconds 3` injected into the PowerShell probe so it
     always exceeds the 2 s execFile budget; expect the two-process takeover test to time out at
     30 s with `killed 1 dangling process`, exactly as in the issue.

## Fix (each item verified by the listed gate)

1. `locks/process-start-time.ts`: `readWin32ProcessCreationFiletime(pid)` via `bun:ffi` kernel32
   `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetProcessTimes` + `CloseHandle`.
   Gate: new `test.if(win32)` cases in `process-start-time.test.ts` (brackets spawn instant, equals
   PowerShell `StartTime.ToFileTimeUtc()`, null for dead/invalid pids, identity scheme), run on
   windows-latest CI; POSIX suite on mengmotaMac unchanged.
2. `locks/process-identity.ts`: win32 -> dead pid short-circuit, kernel32 filetime identity
   `win32-creation-filetime:<u64>`, PowerShell only as the fallback when bun:ffi is unavailable.
   Foreign pids stay uncached (#8268 memo untouched). Gate: same as 1 plus
   `process-identity-cache.test.ts`.
3. `concurrency/two-process.test.ts`: recovery gated on `isLockOwnerProvenDead(holderRecord)` via
   bounded `probeUntil` (fails loud); harness rejects pending line waiters on child `close` with
   stdout/stderr attached; fixture removal retries EBUSY/EPERM/ENOTEMPTY within a bounded budget
   and throws with context. Gate: file passes on mengmotaMac and on windows-latest soak x10.
4. `.github/workflows/windows-flake-soak.yml`: permanent `memory-two-process` target.
5. Rebuild `packages/omo-senpi/plugin/extensions/*` in a linux/amd64 container (bun 1.4.2), since
   the bundles embed memory-core's process identity code and CI checks bundle drift.
6. GREEN evidence: fix + the same PowerShell stall injection passes on windows-latest; soak x10 of
   the fixed test; three consecutive green `test (windows-latest, 1/2)` runs at the final head.

## Constraints honoured

No timeout raise, no `.skip`, no test retry, no loosened assertion, no foreign-pid caching,
<= 250 pure LOC, no `bun test` on this machine (POSIX runs on mengmotaMac via bunshin).
