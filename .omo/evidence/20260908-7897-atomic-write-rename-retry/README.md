# Windows EPERM on team state.json atomic rename (#7897)

## What was tested

Host: Linux x86_64, bun 1.4.0, branch off dev `11d5155a8`. Windows is not available here, so every
Windows behavior is driven through the injectable `platform` / `rename` / `delay` seams on
`atomicWrite`, using the exact errno shape from the issue report
(`EPERM`, `errno -4048`, `syscall: "rename"`).

- `unit-gate.txt` - RED run of the four new cases against the unpatched `locks.ts` from `dev`,
  GREEN run with the fix, the full `packages/team-core` suite, and `tsgo --noEmit` for
  `team-core`, `senpi-task`, and `omo-opencode` (the three projects that compile this file).
- `fault-injection.ts` - harness that calls the real `atomicWrite` against a real temp directory
  (real `open`, real `writeFile`, real `fsync`, real `rm`), injecting rename failures only.
  Five scenarios: transient EPERM, transient EBUSY at the retry boundary, permanent EPERM,
  POSIX EPERM, and a burst of 8 concurrent writers with every third rename failing once.
- `fault-injection-before.txt` / `fault-injection-after.txt` - the same harness run against the
  unpatched `dev` file and against the fix.

## What was observed

RED: `atomicWrite retries a transient Windows EPERM on rename and then lands the new content` and
`atomicWrite stops retrying a Windows rename after the bounded attempts and leaves no partial file`
both fail on unpatched `dev` (12 pass / 2 fail). With the fix, 14 pass / 0 fail, and the whole
`team-core` package is 163 pass / 1 skip / 0 fail. The pre-existing
`atomicWrite leaves no partial file when rename fails` case is unchanged and still passes: a plain
`Error` with no `code` is not treated as contention, so it does not retry. `tsgo` is rc 0 for all
three projects.

Fault injection, before -> after:

| Scenario | Before | After |
|---|---|---|
| win32, EPERM twice then success | 1 rename call, rejected EPERM, file still `old` | 3 rename calls, resolved, file is `new`, 153 ms |
| win32, EBUSY 4x then success | 1 call, rejected EBUSY, file still `old` | 5 calls, resolved, file is `new`, 507 ms |
| win32, EPERM permanent | 1 call, rejected EPERM | 5 calls, rejected EPERM after 512 ms, file still `old` |
| linux, EPERM once | 1 call, rejected EPERM | 1 call, rejected EPERM, 9 ms (no retry, no delay) |
| win32, 8 concurrent writers, every 3rd rename fails | 6 fulfilled / 2 rejected | 8 fulfilled / 0 rejected |

No run left a `state.json.tmp.<uuid>` file behind, in either direction, including the exhausted
and the POSIX paths. The final `state.json` parsed as valid JSON in every run, so the retry does
not introduce a torn write: each attempt renames the same fully written and fsynced temp file.

The concurrent-burst row is the shape reported in the issue. Three plugin hooks
(`member-error-handler`, `background-agent`, `team-mailbox-injector`) write the same
`state.json` through `saveRuntimeState` / `transitionRuntimeState`, and on `dev` a single
contended rename drops that writer's update permanently.

## Why it is enough

The failure being fixed is a syscall error code, and the code path from `saveRuntimeState` down to
`rename` is straight-line, so injecting the documented errno at the `rename` boundary exercises the
same branch a real Windows Defender scan would. Both the recovery path and the give-up path are
pinned, including the exact delay sequence (50, 100, 150, 200 ms), so a future change to the
attempt count or backoff cannot pass silently. The POSIX case is pinned negatively: on Linux and
macOS `EPERM` from `rename` means a sticky bit, an immutable flag, or a cross-mount move, and
retrying would only add latency to a guaranteed failure.

Not covered: a real Windows host with a real antivirus filter driver. This host cannot produce one.
CI runs the same suite on `windows-latest`, and the changed test file basename does not force the
full matrix, so the PR carries the `ci:full-matrix` label to get the Windows leg.

Residual risk: a rename that is contended for longer than the ~500 ms retry window still fails, as
before. That is deliberate. `transitionRuntimeState` already holds `state.lock` around this write,
so a longer window would block other hooks; the bound keeps the failure fast and visible instead of
converting it into a stall.

## What was omitted

No credentials, tokens, environment dumps, or private paths. Every temp directory in the harness is
created under `os.tmpdir()` and removed at the end of its scenario.
