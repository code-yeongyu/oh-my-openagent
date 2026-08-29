# Senpi lock-holder lifecycle fix - evidence README (2026-08-25)

Branch `fix/senpi-memory-lock-holder-lifecycle` @ base 8c57e463e, worktree oom-wt-senpi-lock-lifecycle.
Plan: `.omo/plans/20260825-senpi-lock-holder-lifecycle.md`.

## CURRENT-BASE REFRESH

The implementation and all ignored plan/evidence artifacts were preserved while the branch was
fast-forwarded from 26865364e to current `origin/dev` at 8c57e463e. See
`current-base-verification.md` for the command/result ledger.

- Focused lifecycle/prune/preflight battery, three consecutive rounds: **37 pass / 0 fail / 108 expectations per round**; exact task-owned process scans were clean after every round.
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: exit 0.
- `bun run test:senpi`: **2270 pass / 7 skip / 0 fail**, plus evidence-resolver tests **10 pass / 0 fail**. Build-generated plugin bundle dirt was verified as generated-only and restored.
- `drive.mjs --self-test`: PASS on the current tree (`current-base-drive-selftest.log`).
- Live `memory-e2e.mjs` against Senpi 2026.8.11-4: S1 passed on both the change tree and an exact detached current-base worktree. Both trees then failed S2 identically with the pre-existing stale-extension-context path followed by Node ESM `ERR_MODULE_NOT_FOUND` for extensionless `src/extension/compose`; compare `current-base-memory-e2e.log` and `current-base-memory-e2e-base.log`. This live S2 lane is an honestly recorded base-identical infrastructure blocker, not a pass and not introduced by this diff.
- The driver aborts before its final real-home digest assertions on that S2 exception, so this refresh does not claim a new end-of-driver isolation pass. The driver-created sandboxes were isolated under `/tmp/omo-senpi-qa-*`, all six roots from the two comparison runs were removed, the detached base worktree was removed, and task-owned process scans were clean. The earlier lane's completed isolation evidence remains recorded below.

> **This README was rewritten by fresh-audit lane 2.** Lane 1's record is retained below under
> "PRIOR LANE RECORD"; its Wave A/Wave B verdicts are SUPERSEDED by this lane's waves
> (`wave-1-fresh-verdict.md`, `wave-2-fresh-verdict.md`) and were not trusted as proof.

## FRESH AUDIT (lane 2) - observation ledger and edits

Fresh full diff + adjacent scope read from disk (not from lane 1 notes). Ledger:

| # | Class | Observation | Resolution |
|---|-------|-------------|------------|
| 1 | P2 | `exitedWithin()` doc claimed "exited AND stdio closed" but resolved on first of `exit`/`close`. Node semantics: `close` always follows `exit` and lags indefinitely behind fd-inheriting descendants; acceptance requires teardown to await child TERMINATION before removing roots (locks die with the process; pipes carry no root-resident state). Correct contract = termination-gated. Behavior was already correct; documentation was wrong and nothing pinned it. | Helper moved to `worker/process-liveness.test-support.ts`, exported, doc corrected to termination-gated with rationale. A mutation-detecting test proved UNCONSTRUCTABLE on Bun (see `fresh-mutations-and-bun-probe.md`: Bun auto-destroys parent-side stdin at child exit, so `close` trails `exit` by ~6ms even with a living descendant); a draft discriminator test was removed rather than shipped as pretend-coverage. |
| 2 | P2 | model-preflight grandchild test gave the wrapper only a **250ms** budget to boot AND register both pid files before the probe SIGKILLs it; `readPidWhenWritten` then hard-fails -> loaded/Windows CI flake. | probeTimeoutMs 250->1000, outerBound posix 500->2500 / win32 5000->10000. Not a weakening: the grandchild parks forever, so any finite bound proves non-waiting; assertion kinds unchanged; result still lands at ~probeTimeout far below the bound. |
| 3 | P2 | Abrupt-wrapper regression wrote the holder pid immediately after `spawn()` - before exec, let alone `held\n` - so it proved "a just-spawned process dies on stdin EOF", NOT "a lock-HOLDING holder exits on abrupt wrapper death". Additionally, even readiness-gating alone could be satisfied by a fixture that exits voluntarily right after `held`. | Wrapper now dwells 150ms after observing `held\n`, snapshots holder liveness into `holder-alive-at-death.txt`, then self-SIGKILLs. Test asserts snapshot == "alive" (holder genuinely parked at wrapper-death instant) before asserting bounded EOF-exit. M2 mutant (non-parking fixture) proven RED then GREEN after revert. |
| 4 | P3 | Unused `AddressInfo` type import in model-preflight.test.ts. | Removed. |
| 5 | P3 | hold-lock-lifecycle test 2 reimplemented `killIfAlive` inline. | Uses shared helper. |
| 6 | noise | facts-run-prune afterEach spawn-failure edge would burn 2x grace then throw a misleading "survived" error. Unreachable: fixture path and execPath are static-valid. Left as-is deliberately. | Documented, no edit. |
| 7 | noise | "subscriber exploded" lines in test:senpi output are intentional error injections from untouched `dag-runtime.test.ts`. | Documented, no edit. |

Verified sound without edits: fixture parks on pure I/O wait (~0% CPU measured by lane 1, re-verified structurally: no timers); EOF/close/error + abrupt-parent-death paths all resolve; teardown orders rm STRICTLY after confirmed termination with bounded TERM->KILL escalation that throws loudly; `pidAlive` zombie-aware on linux, ESRCH vs EPERM distinguished; control-channel double-close guarded via WeakSet; late-booting helpers hitting a closed control port exit(0) via error handler; production `probeChildModels` awaits `exit` only (never `close`), matching the degrade-without-grandchild requirement.

### Fresh commands and results (all on final tree)

- Focused battery x3 (`fresh-focused-x3.log`): hold-lock-lifecycle + facts-run-prune + facts-failure-streaks + model-preflight = **37 pass / 0 fail per round**, process-table residue scan after EVERY round: CLEAN (exact task-owned patterns only: `hold-lock.ts`, `grandchild.mjs`, `abrupt-wrapper`, `exit-vs-close-wrapper`, tmp-root prefixes).
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` (`fresh-typecheck.log`): exit=0.
- `bun run test:senpi` (`test-senpi-gate-final.log`, pipefail-honored): **2270 pass / 7 skip / 0 fail**, gate-exit=0. Generated bundle dirt from the build stage was restored; working tree contained exactly the five source/test deliverables plus the plan/evidence artifacts.
- Mutation proofs: `fresh-mutations-and-bun-probe.md` (M1 close-gated mutant + Bun probe; M2 non-parking fixture RED->GREEN).

### Protocol note

clean_streak/wave bookkeeping for this lane: every source/test/evidence-correction edit reset the
streak to 0. Writing a wave's OWN verdict file is part of that wave step (recording its result),
not a scope-affecting edit, and does not reset the streak; only corrections to previously written
claims would. Final sequence: last code edit -> QA battery -> evidence rewrite (this file) ->
Wave 1 -> Wave 2. Stop condition: two consecutive clean fresh waves.

## WHAT WAS TESTED (cumulative, lanes 1+2)

1. **Failing-first process-lifecycle regressions** (`worker/hold-lock-lifecycle.test.ts`):
   - holder exits within a bounded time when its parent-owned stdin pipe reports EOF WITHOUT any signal;
   - holder exits within a bounded time when a wrapper parent abruptly SIGKILLs itself AFTER proving the holder held its marker and was still parked (alive-at-death snapshot), so no teardown can run.
2. **Existing behavior pinned**: facts-run-prune.test.ts (lock contention, dead-owner recovery, pruning, reservation), facts-failure-streaks.test.ts, worker/model-preflight.test.ts (timeout/pipe-holder degradation) - expectations unchanged, all green.
3. **Package gates**: tsgo exit=0; `bun run test:senpi` 2270 pass / 7 skip / 0 fail.
4. **Leak detection**: focused suites re-run repeatedly across both lanes; exact-pattern process-table scans clean after every round.
5. **Senpi QA skill lanes (lane 1)**: drive.mjs --self-test PASS; live memory-e2e S1 passed; S2/facts-backlog failures REPRODUCED IDENTICALLY ON BASE (see lane-1 logs) - environmental, not introduced by this diff.
6. **Bounded CPU reproduction (lane 1)**: old fixture 99.8% CPU; new stdin park 0.3%; event-driven park self-exits when the pipe owner dies.

## WHY IT IS ENOUGH

- Both mandated orphan classes are structurally impossible in these lanes: hold-lock cannot outlive its parent-owned pipe (RED-on-old/GREEN-on-new regressions, now with an alive-at-death premise proof), and model-preflight helpers are tied to a test-parent-owned socket with fail-safe kills plus terminal-within-bound assertions.
- Teardown ordering is enforced and now uses a correctly documented termination contract; temp roots are removed only after tracked children are confirmed exited.
- The two challenged design points were settled from Node/Bun semantics with captured runtime evidence, not from the prior lane's self-report: the exit-vs-close gating question is resolved (termination-gated; divergence unobservable under Bun, probe captured) and the preflight timing budget no longer depends on a 250ms startup assumption.
- Residual risk (documented): win32 behavior of self-SIGKILL in the abrupt-death test (repo precedent exists); supervised fixtures elsewhere remain deadline-bounded and out of mandated scope.

## WHAT WAS OMITTED

- No secrets, tokens, or auth headers in any artifact; driver env snapshots filter credential keys.
- Raw senpi child stderr summarized, not dumped; sandbox sysdump paths recorded instead of contents.
- Probe scripts lived under `/tmp/opencode/senpi-probe` and were deleted after capture (`fresh-mutations-and-bun-probe.md` holds the outputs).

## AUDIT WAVES (lane 2 - authoritative)

- Wave 1: see `wave-1-fresh-verdict.md`.
- Wave 2: see `wave-2-fresh-verdict.md`.
- Lane 1's `wave-a-verdict.md` / `wave-b-verdict.md` carry a SUPERSEDED banner; retained for history only.

## PRIOR LANE RECORD (lane 1; superseded where contradicted above)

- RED proof: `red-hold-lock-lifecycle.log` (old fixture survived pipe EOF and abrupt wrapper death).
- CPU repro artifacts and live-driver logs (`qa-memory-e2e.log`, `qa-memory-e2e-BASE.log`, `qa-facts-backlog-e2e.log`) document the 99.8%->0.3% CPU fix and the pre-existing base failures of two live drivers (ERR_MODULE_NOT_FOUND for extensionless `./compose` under plain-Node ESM loading; ERR_UNSUPPORTED_DIR_IMPORT inside untouched memory-core). Isolation: drivers build their own sandbox agent dirs; real `~/.senpi/agent` untouched.
- Lane-1 cleanup receipt: removed `/tmp/opencode/senpi-lock-repro`, repro copies, task-owned QA sandboxes; process table verified clear.
