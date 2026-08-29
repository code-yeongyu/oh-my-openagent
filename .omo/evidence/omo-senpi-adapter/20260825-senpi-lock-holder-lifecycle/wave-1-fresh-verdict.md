# Wave 1 - fresh full-diff + adjacent-scope audit verdict (fresh-audit lane 2)

Date: 2026-08-25. Scope re-read INDEPENDENTLY from disk this wave: complete `git diff`
(3 modified files), both untracked deliverables read in full, fixture, production
`model-preflight.ts`, adjacent callers (`facts-run-prune.test.ts` holdLock sites,
`facts-failure-streaks.test.ts` import), teardown paths, and every process-liveness helper.
clean_streak entering this wave: 0 (marker-poll fix applied after the previous wave attempt
found observation #8; that wave did not count).

## Scrutiny axes

1. exitedWithin contract: doc now termination-gated (`exit`, or later `close`) with explicit
   rationale; implementation resolves on first of exit/close plus already-dead fast path;
   divergence-from-close-gating proven unobservable under Bun (probe captured in
   `fresh-mutations-and-bun-probe.md`). NO OPEN FINDING.
2. Abrupt-wrapper premise: pid registered only after `held\n` + 150ms dwell; alive-at-death
   marker asserted "alive" via bounded poll (two-write race closed by `readMarkerWhenWritten`);
   M2 non-parking-fixture mutant RED -> GREEN. NO OPEN FINDING.
3. Preflight determinism: 1000ms probe budget vs 2500/10000 platform-scoped outer bounds;
   grandchild pid registered synchronously by the wrapper (no grandchild-boot dependency);
   WeakSet-guarded channel close; try+finally fail-safe kills with terminal awaits; late
   connectors exit(0) on a closed port. NO OPEN FINDING.
4. Teardown ordering (rm strictly after confirmed termination), signal escalation
   (TERM->bounded->KILL->bounded->throw), timer/listener cleanup on settle, zombie-aware pid
   probes, ESRCH-vs-EPERM handling, exact-PID-only kills, win32-scoped outer bound: verified on
   current disk state. NO OPEN FINDING.

## Ledger deltas this wave

- Fixed: #8 (P3) bare readFile of holder-alive marker could race the wrapper's two-write turn
  (ENOENT flake). Replaced with bounded `readMarkerWhenWritten` poll; focused battery x3 green
  (37 pass / 0 fail each), residue scans CLEAN x3, tsgo exit=0.
- Noise (documented, no action): afterEach spawn-failure edge unreachable; "subscriber exploded"
  lines are intentional dag-runtime error injections; test files exceed the 250-LOC source
  guidance per repo's colocated-suite convention.

## Verdict

P0: none. P1: none. P2: none open. P3: none open. noise: 3 documented.
**WAVE 1 CLEAN. clean_streak = 1.**
