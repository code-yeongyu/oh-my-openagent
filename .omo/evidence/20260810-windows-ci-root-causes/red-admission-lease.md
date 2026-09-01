# RED - renewable admission lease on Windows

## What was tested

PR #6705, GitHub Actions run 31363755978, job 93377692180 executed the full root suite on `windows-latest`, including:

```text
packages\senpi-task\src\lifecycle\admission-lease.test.ts
```

## What was observed

```text
expect(waiter.kind).toBe("contended")

Expected: "contended"
Received: "acquired"

(fail) acquireSessionAdmissionLease > #given a holder that keeps renewing #when a waiter contends past several stale windows #then the holder is NOT reclaimed and the waiter yields contended [437.00ms]
```

Raw job:
https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31363755978/job/93377692180

## Why this is enough

The real Windows runner reclaimed a lease whose holder was intended to remain live. The test depended on 40 ms renewal ticks, a 120 ms stale threshold, and a 300 ms real-time wait inside a 14k-test process. Scheduler starvation made the wall-clock test nondeterministic.

## What was omitted

Unrelated test output was omitted. The exact assertion, received value, duration, source path, and public job URL are retained.
