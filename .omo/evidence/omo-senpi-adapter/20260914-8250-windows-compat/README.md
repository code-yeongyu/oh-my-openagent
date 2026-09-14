# Issue #8250 QA evidence

## What was tested
- Diagnostic Windows CI at run 34804691478 measured every process-start identity lookup and captured the replacement fixture errno.
- Failing-first unit regression: `bun test packages/memory-core/src/locks/process-identity-cache.test.ts` against the uncached reader.
- Focused gate on a second platform: process identity cache + lock record + the three reported Senpi test files.
- Senpi package gate: `bun run test:senpi`.
- Built the packaged Senpi plugin with `bun run build:senpi-plugin`.
- Real Senpi adapter driver in an isolated agent directory.
- Final Windows CI and three consecutive Windows job attempts are appended below after the final head runs.

All Bun tests and builds ran remotely under `/tmp/omp-8250-20260913/`; no `bun test` ran on the originating workstation.

## What was observed
- Windows diagnostic: 2,063 process identity probes, 2,061 for the current PID. Median 305.1ms, p95 409.4ms, max 2,416.6ms, cumulative 661.9s. Replacement rename failed with `EPERM` while the report handle was open.
- RED: 2 pass, 2 fail. Concurrent/subsequent current-PID requests performed 3 OS lookups instead of 1; a recovered successful lookup was not retained.
- Focused GREEN: 75 pass, 0 fail, 216 expectations, 16.30s. Typecheck emitted no output and exited 0.
- Package GREEN: 3,428 pass, 32 platform skips, 0 fail; 12,752 expectations; 782.66s. Evidence resolver: 10 pass, 0 fail.
- Plugin build exited 0 and regenerated the four tracked extension artifacts affected by the memory-core import.
- Live driver result was PASS: ultrawork injection and comment-checker passed using an isolated sandbox agent directory. Protected-state changed-path lists were empty. Whole-home isolation certification was unavailable because directory identity could not be observed on that host, so the evidence does not overclaim it.
- Reflection recap live QA was attempted once and failed at its 90s durable-completion circuit breaker. This was retained as a separate observed failure; the adapter live driver and package gate are the runtime proof used for this change.

## Why this is enough
- The regression tests distinguish safe current-process memoization from unsafe foreign-PID caching, including concurrency, null recovery, rejection recovery, process exit and PID reuse.
- The three original failure surfaces run together with the real lock domain and exact assertions.
- The package gate exercises every omo-senpi test in one process; final Windows CI proves the platform behavior under the original suite load.
- The replacement test no longer depends on a filesystem operation Windows forbids, but still drives the report reader through a changed path identity and requires `changing_file`.
- Subscribe-before-trigger ordering makes child-ready delivery deterministic rather than increasing a timeout.

## What was omitted
- Raw environment dumps, credentials, user-home paths, provider request bodies and machine identity are not copied here.
- Raw live-driver JSON is summarized because it contains host-local paths.

## Cleanup
Remote workspace and sandbox cleanup receipts are appended after final CI evidence is gathered.
