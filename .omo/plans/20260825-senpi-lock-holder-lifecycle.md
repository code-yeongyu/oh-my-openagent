# Plan — Senpi lock-holder lifecycle: orphan-process + CPU leak fix

Branch: `fix/senpi-memory-lock-holder-lifecycle` @ origin/dev (8c57e463e). Worktree: oom-wt-senpi-lock-lifecycle.
Evidence: `.omo/evidence/omo-senpi-adapter/20260825-senpi-lock-holder-lifecycle/` (resolved ONLY via `.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs`).
Discipline: failing-first TDD, journal at `.debug-journal.md` (git-excluded locally), no commits/push during implementation; finalization was authorized after verification.

## Problem (incident + code reading)

- Incident: 18 PPID-1 `__fixtures__/hold-lock.ts` processes at ~48-62% CPU each, paired across finalize/facts-runs marker locks.
- `hold-lock.ts` parks on `await new Promise<never>(() => {})` after acquiring the marker: no parent-liveness channel, so any parent death before `afterEach` orphans it forever.
- `facts-run-prune.test-support.ts` teardown SIGKILLs tracked children and `rm -rf`s temp roots WITHOUT awaiting exit; order is wrong (roots removed while children may live).
- `model-preflight.test.ts` grandchild-pipe test keeps wrapper + grandchild alive with `setInterval(() => undefined, 30_000)` (lines 176/178). The wrapper is only killed by preflight's timeout timer, which lives IN the test parent; abrupt test-parent death orphans both. Wrapper stdin is `"ignore"` (production spawn config in model-preflight.ts), so the wrapper has no stdin channel.

## Root-cause hypotheses (to be runtime-confirmed before fixes)

1. H1: memory-core lock leaves a timer running post-acquisition (CPU source). Refute/confirm via bounded CPU measurement of bare bun vs full fixture.
2. H2: Bun busy-spins on a forever-pending top-level await with open stdio pipes (CPU source). Same measurement; node comparison isolates Bun.
3. H3: Orphaning is structural (no liveness channel + teardown not awaiting exit + interval keep-alives untied to test parent). Confirmed via RED regression tests.
4. H4: CPU comes from the stdout write path / unread pipe. Measured with consumed vs unread stdout.

## Changes (exact files)

### 1. NEW `packages/omo-senpi/src/components/memory/worker/hold-lock-lifecycle.test.ts`
RED-first process-lifecycle regressions (spawn real `bun` children, every PID tracked, all waits bounded, fail-safe SIGKILL in finally so a failed assertion cannot leak):
- `#given a hold-lock child with a parent-owned stdin pipe #when the pipe reports EOF #then the child exits within a bounded time` (teardown-style: destroy stdin, NO signal).
- `#given a wrapper parent owning the child's stdin pipe #when the wrapper is abruptly SIGKILLed so no teardown can run #then the child still exits within a bounded time`.
Both MUST fail against current `hold-lock.ts` (capture RED output as evidence) before any production/fixture edit.

### 2. `packages/omo-senpi/src/components/memory/worker/__fixtures__/hold-lock.ts`
Replace the forever-pending promise with an event-driven park on the PARENT-OWNED stdin pipe (`end`/`close`/`error` -> resolve -> natural exit). No timers, no polling, negligible CPU. Marker-acquisition + `held\n` handshake unchanged. Lock semantics unchanged (marker file; dead-owner recovery unaffected).

### 3. `packages/omo-senpi/src/components/memory/facts-run-prune.test-support.ts`
Ordered teardown in `afterEach`: for each tracked child (skip already-exited): request SIGTERM -> await real exit AND stdio close within bounded window -> escalate SIGKILL only if needed -> await exit again -> throw loudly if a child survives both bounds. Remove temp roots ONLY AFTER every tracked child is confirmed exited. `holdLock()` readiness handshake unchanged.

### 4. `packages/omo-senpi/src/components/memory/worker/model-preflight.test.ts` (grandchild-pipe test only)
Remove BOTH `setInterval(() => undefined, 30_000)` helpers. Test-parent-owned control channel: a loopback TCP server on 127.0.0.1:0 whose port is passed via env to the test-authored wrapper; wrapper AND grandchild park event-driven on that socket (`close`/`end`/error -> exit). Grandchild keeps stdio ["pipe"(stdin owned by wrapper), "inherit", "inherit"] so it still holds the probe's output pipes and outlives the launcher when preflight SIGKILLs the wrapper at the 50ms timeout — timeout/pipe-holder behavior preserved. Wrapper additionally reports its own pid. Test asserts BOTH pids terminal within a bound after the control server closes; `.finally` fail-safe SIGKILLs survivors (bounded) so assertion failure cannot leak. Abrupt test-parent death: OS closes sockets -> children exit (no orphan possible from this harness).

## Verification ladder

1. RED: new lifecycle tests fail on current fixture (captured).
2. GREEN: fixture/support edits turn them green; focused reruns x5 with process-table check after each (`ps` for hold-lock/wrapper/grandchild stragglers; only PIDs from our harness).
3. Existing behavior pinned: full `bun test packages/omo-senpi/src/components/memory/facts-run-prune.test.ts`, `.../worker/model-preflight.test.ts`, then relevant memory worker/pruning suites.
4. Gates: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`; `bun run test:senpi`.
5. Senpi QA per skill: `drive.mjs --self-test`; live lane if senpi binary exists (MISSING on PATH at start = recorded blocker unless found); evidence README with what/observed/why/omitted.
6. No-excuse TS audit + LOC check on changed files (<=250 pure LOC).
7. Audit waves: full diff + adjacent lifecycle scope; classify P0/P1/P2/P3/noise; fix everything incl. noise; reset clean counter on any edit; finish after TWO consecutive clean waves.

## Out of scope

Production memory lock semantics (memory-core), production spawn config in model-preflight.ts, other worktrees, Topstep/unrelated processes, commits/PRs.
