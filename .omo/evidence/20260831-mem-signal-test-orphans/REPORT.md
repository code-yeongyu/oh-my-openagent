# Signal test fixture orphan cleanup

Branch: `fix/mem-signal-test-orphans`

## RED

Commit `b607d24b5` recorded fixture parent and child PIDs and added the no-survivors assertion without kill teardown. Remote command:

```text
bun test v1.4.0 (34cbb9a40)
...
error: expect(received).toThrow()
Received function did not throw
Received value: true
(fail) ... #then no fixture process survives any signal scenario
6 pass
3 fail
```

The assertion failure proves the recorded fixture child survived the scenarios.

## GREEN

Final commit `6f2a1673e` adds SIGKILL teardown, bounded process-gone verification, and tracks the re-exec fixture PID. Remote command:

```text
SHA=6f2a1673e
bun test v1.4.0 (34cbb9a40)
...
8 pass
0 fail
15 expect() calls
Ran 8 tests across 1 file. [3.08s]
```

The teardown kills all recorded parent and fixture child PIDs, verifies each is gone with `process.kill(pid, 0)`, then removes its temporary directory. The suite-level `afterAll` assertion independently verifies no recorded fixture PID remains alive.
