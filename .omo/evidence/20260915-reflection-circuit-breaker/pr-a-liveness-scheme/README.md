# PR-A: scheme-safe run liveness, supervisor identity via memory-core, diagnosable reconcile failures

Issue: #8304 (sections 1 and 3). Base: dev @ db37b83af. Host: a macOS arm64 developer machine, bun 1.4.2.

## WHAT WAS TESTED

- C1 `worker/run-liveness.test.ts` (unit): `classifyRunProcess` / `isLauncherDead` with a live pid whose recorded identity is `ps-lstart:...` and whose actual identity is `proc-start-epoch:...`; same-scheme differing identities; ESRCH; scheme-less legacy identities.
- C2 `worker/run-reconciliation-liveness.test.ts` (integration, real process): a real live `bun -e` sleeper stands in for supervisor and child; the ledger records `ps-lstart:` identities; `reconcileReflectionRuns` runs with the REAL memory-core liveness readers (libproc on darwin) and an injected `waitForOutcome` that returns `timeout`.
- C3 `worker/supervisor-process-identity.test.ts`: `getSupervisorProcessStart(process.pid)` and memory-core `getProcessStartIdentity(process.pid)` share one scheme in one runtime.
- C4 `worker/run-reconciliation-failure-detail.test.ts`: dead supervisor + dead child with and without a `child-stderr.log`; completion record `reason` and `detail`.
- Regression: `bun test packages/omo-senpi/src/components/memory/worker/run-reconciliation* run-finalization* run-liveness* supervisor-process-identity*` (56 tests), then the full memory component and memory-core suites (gates.txt).

## WHAT WAS OBSERVED

- RED before the change: C1 2/7 fail (`dead` and `true` on cross-scheme), C2 the live run is reconciled as `[{ runId: "run-orphan", outcome: "failed" }]` (the exact shape from the incident), C3 `Expected "proc-start-epoch" Received "ps-lstart"`, C4 `detail` undefined in both shapes. Files: red-*.txt.
- GREEN after the change: C1 8/8, C2 the run stays active with its worktree and no final.json, C3 schemes equal, C4 detail carries the stderr tail or names the dead processes. Files: green-*.txt.
- No stray sleeper processes remained after the C2 run (`ps` probe: 0).
- tsgo exit 0 for packages/omo-senpi and packages/memory-core.

## WHY IT IS ENOUGH

The defect is a pure comparison rule plus a reader mismatch. C1 pins the rule at the seam every caller uses (reconcile prelaunch, run-dir loop, dead-supervisor path). C2 proves it through the real reconciliation entry point with a real live process and the real darwin reader, so the incident shape cannot recur on this platform. C3 pins that new ledgers no longer create the mismatch. C4 pins the detail contract for the path that produced every empty-detail record since 2026-09-11. Existing race/crash/precedence suites stay green, so the change did not widen any destructive path.

## WHAT WAS OMITTED

- No live `senpi` CLI session was driven: the change is a pure classification + reader delegation with no new UI or hook surface, proven at the real reconciliation seam with real processes.
- Windows: the supervisor keeps its documented null identity, so nothing changed there; not exercised on a Windows host (CI covers the platform matrix when relevant paths change).
- No raw logs or identifiers from the reporting host are included; the completion-record shapes are reproduced synthetically in the fixtures.
