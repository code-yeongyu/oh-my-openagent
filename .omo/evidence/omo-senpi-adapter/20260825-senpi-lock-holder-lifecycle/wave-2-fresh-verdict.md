# Wave 2 - fresh full-diff + adjacent-scope audit verdict (fresh-audit lane 2)

Date: 2026-08-25. Second consecutive independent pass. Re-read from disk this wave: full
`git diff` (digest-stability anchor `f3ef113a4dad...`), all five deliverables (sha256 recorded
in the wave transcript), adjacent consumer set, production seam, process table, and artifact
sweep. clean_streak entering: 1.

## Independent verifications

- Adjacent consumers are EXACTLY: model-preflight.test.ts and hold-lock-lifecycle.test.ts
  (process-liveness helpers), facts-run-prune.test.ts and facts-failure-streaks.test.ts
  (facts-run-prune.test-support). No untracked consumers.
- Production seam `model-preflight.ts` probeChildModels: SIGKILL at timeout, awaits
  `child.once("exit")` ONLY - never `close` - so the degrade-without-grandchild contract holds
  and the test's premise (grandchild holding inherited pipes past launcher death) is the real
  hazard. Untouched by this diff.
- Strict-TS scan over all five deliverables: no `as any`, `@ts-ignore`, `@ts-expect-error`,
  non-null assertions, or empty catches. No `pkill`/`killall`; every kill targets an exact
  task-owned pid or tracked ChildProcess handle.
- Process table: exact-pattern scan CLEAN. Working tree: exactly the five deliverables, nothing
  else staged or modified. `/tmp/opencode/senpi-probe` absent (probe artifacts deleted after
  capture; outputs preserved in `fresh-mutations-and-bun-probe.md`).
- Scrutiny axes 1-4 re-verified against current disk state (contract doc, abrupt-death premise
  with alive-at-death marker via bounded poll, preflight timing budget, teardown ordering /
  escalation / timer cleanup / zombie+PID-reuse handling / win32 scoping): NO OPEN FINDING.

## Verdict

P0: none. P1: none. P2: none open. P3: none open. noise: unchanged (3 documented items).
**WAVE 2 CLEAN. clean_streak = 2. PROTOCOL TERMINATED.**
