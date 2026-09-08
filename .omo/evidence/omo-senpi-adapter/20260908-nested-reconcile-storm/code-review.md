# Code review: nested Senpi marked-child reconciliation skip

- `codeQualityStatus`: WATCH
- `recommendation`: APPROVE
- `final`: APPROVE
- `blockers`: none

Skill-perspective check: **ran**. The reviewer loaded and applied
`remove-ai-slops`, `programming`, and the TypeScript references. The inspected
diff does **not** violate either perspective.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

1. `packages/omo-senpi/scripts/qa/task-child-reconcile-e2e.mjs:38,208-239`
   uses a three-second negative observation window. The harness subscribes
   before triggering the resumed session, and the paired RED detected the
   pre-fix PID replacement inside that window. This is residual live-QA
   determinism debt, not a demonstrated failure.

## programming / TypeScript correctness — PASS

- No new `any`, assertions, ignore directives, or suppressions in production.
- Context capture still precedes the guard.
- The marked return occurs before task RPC attachment and root recovery.
- The unmarked path remains byte-identical after the marker guard.
- Behavioral tests fail when the old production condition is restored.
- Root process QA continued the same task across replacement root PIDs.
- Explicit terminal `rpc_detached` `task_send` revival remains in the separate
  steering path and passed its focused tests.
- Independent reviewer rerun: lifecycle tests 10 passed, 0 failed; changed
  TypeScript LSP diagnostics clean.

## remove-ai-slops / overfit — PASS

- The production change is one necessary guard at the shared lifecycle seam.
- No speculative abstraction, fallback, parser, compatibility layer, or
  test-only production hook was added.
- Tests assert machine-consumed behavior, not prompt prose.
- The 236-pure-LOC QA driver has one live-process responsibility and reuses
  existing sandbox, runtime, process, and state helpers; splitting it would be
  cosmetic.
- The marker matches the existing process-sweep boundary.

## Scope control

The reviewer confirmed all intended source, test, QA, generated bundle, and
evidence files are separable from the four declared unrelated dirty files.
The intended tracked diff has no whitespace errors.

## Evidence audit

- Production RED changed nested PID `2946015` to `2946525`.
- Production GREEN retained PID `3011916` and emitted no reconcile event.
- Root GREEN continued task `st_01a081b4` across replacement root process.
- Cleanup and real-agent isolation receipts are present.
- Full verification totals are recorded in `verification.txt`.
- The extra unchanged broad-driver FAIL is documented and not counted as a
  passing gate.

## Residual risks

- The marker skips the complete post-capture root-coordinator chain, matching
  the existing process-sweep policy and the explicit capture-only test.
- The negative process proof uses a bounded three-second window; paired RED
  demonstrated sensitivity on this machine.

## Verdict

**APPROVE.** No blockers. `codeQualityStatus` is WATCH only for the documented
bounded negative-proof window.
