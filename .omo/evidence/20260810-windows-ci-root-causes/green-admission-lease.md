# GREEN - deterministic renewable admission lease

## Focused scenario

```bash
bun test packages/senpi-task/src/lifecycle/admission-lease.test.ts -t "holder renewing on virtual time"
```

```text
(pass) acquireSessionAdmissionLease > #given a holder renewing on virtual time #when several stale windows pass before a waiter contends #then the holder is NOT reclaimed and the waiter yields contended [5.99ms]

1 pass
3 filtered out
0 fail
2 expect() calls
```

## Full file

```bash
bun test packages/senpi-task/src/lifecycle/admission-lease.test.ts
```

```text
4 pass
0 fail
19 expect() calls
Ran 4 tests across 1 file. [1.74s]
```

The full file includes basic acquire/release, deterministic live renewal, crashed-holder takeover, and two-waiter CAS fencing.

## Why this is enough

The focused test now drives the real interval callback, filesystem lease write, record mutex, token freshness check, and contention path under virtual time. The mutation proof shows it fails if renewal is disabled. The remaining real-Windows proof will run in the PR matrix.

## Cleanup receipt

Each test releases its lease. The existing `afterEach` removes every temporary state directory. Fake timers are restored in `finally`, and both Bun test processes exited 0.
