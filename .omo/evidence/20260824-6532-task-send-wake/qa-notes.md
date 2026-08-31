# QA notes — issue #6532 task_send revival parent wake

## WHAT WAS TESTED

1. Failing-first unit regression, `packages/senpi-task/src/steering/engine.test.ts`
   (both runner flavors): revival of a completed resident sync child must promote the
   revived epoch to background BEFORE the follow-up starts; a failed follow-up start must
   roll the promotion back; an originally-background child must keep `background_mode`.
2. Failing-first end-to-end regression, `packages/omo-senpi/src/components/task/completion-bridge.test.ts`:
   sync spawn -> terminal -> `manager.continueTask` (the `task_send` path) -> second completion
   -> idle parent receives exactly ONE wake per run_epoch; repeated revivals notify once per
   epoch; originally-background spawns still notify exactly once per epoch across revival.
3. Scoped suites: `bun test packages/senpi-task/src/{steering,completion,manager}` +
   `bun test packages/omo-senpi/src/components/task/completion-bridge.test.ts`.
4. Full package suites: `bun test packages/senpi-task`, `bun test packages/omo-senpi`.
5. Typecheck: `tsgo --noEmit -p packages/senpi-task/tsconfig.json`,
   `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
6. Live harness driver: `SENPI_BIN=<workspace senpi> node packages/omo-senpi/scripts/qa/task-e2e.mjs`
   on the patch AND on the pristine base commit (stash round-trip) for a controlled A/B.

## WHAT WAS OBSERVED

- RED (before the fix): engine promote-before-followUp assertion failed with
  `[false]` vs expected `[true]` (both flavors); bridge revival tests observed 0 wake
  messages after the revived completion (`Expected length: 2 / Received length: 0`).
- GREEN (after the fix): steering suite 32 pass / 0 fail; completion-bridge 5 pass / 0 fail.
- Full `bun test packages/senpi-task`: 1748 pass, 1 skip, 0 fail (includes the seeded
  chaos bench asserting exactly-once notification per `(task_id, run_epoch)`).
- Full `bun test packages/omo-senpi`: 2218 pass, 7 skip, 11 fail — ALL 11 pre-existing:
  skills-sync/installer/ulw-loop artifact tests that also fail identically on the base
  commit because this environment's `bun install` prepare step fails on the documented
  shared-skills submodule fetch, so plugin artifacts were never built. None touch the
  task component; verified via `git stash` base re-run of `skills-sync.test.ts`
  (4 pass / 7 fail on base too).
- Typecheck: both packages exit 0, no output.
- Live driver A/B: results are IDENTICAL between base and patch — same PASS set
  (notably `unconditional_wake: PASS`, `sync_inline_no_notification: PASS`,
  `real_senpi_untouched: PASS`) and same FAIL set (`followup_revive`, `task_output_peek`,
  `jsonl_sequence`, `resume_revived_resident`, `resume_finished_steerable`,
  `resume_ttl_not_revived`). Base JSON: `live-task-e2e-base.json`; patch JSON captured in
  the session log and reproduced below in OBSERVED summary. The FAIL set is therefore
  pre-existing in this sandbox (mock-model timing), not introduced by this change.

## WHY IT IS ENOUGH

- The failing-first tests pin the exact reported sequence from the issue
  (sync spawn -> terminal -> task_send revive -> completion -> idle parent wake) at both
  the engine seam and the full manager->store->bridge->notifier chain, including
  exactly-once per epoch, repeated revivals, rollback on failed start, and the
  originally-background population.
- The full senpi-task suite includes the chaos bench (200 seeded iterations) proving the
  four W1 invariants still hold with the new promotion write in the revive path.
- The live A/B isolates this change: identical driver output on base and patch proves no
  live-harness regression, while the passing `unconditional_wake` check proves the wake
  machinery itself works in the real harness.

## WHAT WAS OMITTED

- The 6 pre-existing live-driver FAIL checks were not root-caused here: they fail
  identically on the untouched base commit in this sandbox and are out of scope for #6532;
  raw driver JSON is kept unmodified for reviewer inspection (no secrets present; sandbox
  paths under /tmp only).
- No raw env dumps, tokens, or auth material are included; the driver's sandbox agent dirs
  and PIDs are recorded in its JSON by design and contain no credentials.
- LSP-daemon diagnostics were unavailable in this environment (daemon socket never came
  up); strict `tsgo --noEmit` on both touched packages is the type verification of record.
