# RED -> GREEN - remaining Windows baseline failures

## RED (base branch, after PR #6708 merged)

`dev` run 31375080844 (head 56593dc78), job `test (windows-latest)`, reported exactly 3 failures:

```text
3 tests failed:
(fail) omo-memory MCP server > #given a fresh project #when create then str_replace run through tools/call #then the memory repo records them [5016.00ms]
  ^ this test timed out after 5000ms.
(fail) acquireSessionAdmissionLease > #given one stale lease and two racing waiters #when both attempt the takeover CAS #then exactly one wins and the loser never deletes the winner's lease [406.00ms]
(fail) /memfs sync > #given a reachable mirror #when sync runs #then the push is reported as successful [5015.00ms]
  ^ this test timed out after 5000ms.
```

Supporting signatures from the same job:

```text
error: EBUSY: resource busy or locked, rm 'C:\Users\RUNNER~1\AppData\Local\Temp\omo-memory-mcp-f8CYoG'
error: expect(received).toHaveLength(expected)
Received: "push to C:\Users\RUNNER~1\...\memory-mirror-TWQI6I failed: remote: fatal: not a git repository: '.'
 ! [remote rejected] main -> main (missing necessary objects)"
```

Run: https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31375080844

## Root causes and fixes

1. `acquireSessionAdmissionLease` racing waiters - the waiters' stale window (150 ms) was far shorter
   than the 1500 ms the loser keeps polling, so one delayed renewal let the loser reclaim a LIVE
   winner. Fixed by driving the race on virtual time (`jest.useFakeTimers`), so the outcome is decided
   by the takeover CAS alone. Real renewal, real lock, real CAS and the ownership assertions are
   unchanged - nothing mocked, skipped, retried or weakened.
2. `omo-memory MCP server` - Windows still holds git's handles when the recursive temp removal runs,
   so `afterEach` threw `EBUSY` and the 5 s default timeout was applied to work that drives real git
   subprocesses. Fixed with a retrying unlink (`maxRetries`/`retryDelay`) and the repo's established
   `setDefaultTimeout(win32 ? 30_000 : 5_000)` convention.
3. `/memfs sync` reachable mirror - the mirror was configured as a raw Windows path, so git resolved
   the remote to `'.'` and rejected the push; the same 5 s default also applied. Fixed by configuring
   the mirror as a canonical, slash-separated `file://` URL (`realpathSync.native` expands the 8.3
   `RUNNER~1` form), matching the already-passing `memory-core` hooks mirror test, plus the same real
   timeout and retrying unlink.

## GREEN (local, macOS)

```text
packages/senpi-task/src/lifecycle/admission-lease.test.ts   4 pass 0 fail
packages/omo-senpi/src/mcp/memory-server.test.ts            4 pass 0 fail
packages/omo-senpi/src/components/memory/commands/memfs.test.ts  15 pass 0 fail
```

The `/memfs sync` mirror case passing locally also proves the production push path accepts the
`file://` mirror URL.

## Mutation proof (racing waiters)

Temporarily stopping the winner's renewal (`renewMs: 50` -> `60_000`, never committed):

```text
error: expect(received).toHaveLength(expected)
Expected length: 1
Received length: 2
(fail) acquireSessionAdmissionLease > ... exactly one wins ...
EXIT=1
```

Reverting the probe restored GREEN (`1 pass 0 fail`, EXIT=0), so the assertion still fails for the
exact regression it names.

## Why this is enough

Each fix removes the actual Windows-specific defect (scheduler-decided ownership, unreleased file
handles, a mangled remote URL) rather than hiding it, and the raising of the two timeouts follows the
convention already merged on `dev` for git-heavy tests. Final proof remains the PR's real
`test (windows-latest)` job.

## What was omitted

Full 14k-test transcripts are not copied; the public run URL is the raw artifact. No secrets, tokens
or environment dumps are included.
