# QA Evidence - Issue #6871 compaction deadlock recovery

## WHAT WAS TESTED

1. Scoped unit suite (new regression tests, given/when/then):
   `bun test packages/omo-senpi/src/components/compaction-recovery`
   Surfaces driven: `FakeExtensionAPI` registration + `session_compact` dispatch;
   pure planner/narrowing units. Proves: rejection narrowing (accepted/manual/
   circuit-breaker events ignored), earliest-safe-boundary planning, toolResult
   boundary skip, no-plan fail-closed, rescue applied through the sanctioned
   `applyCompaction` port with `{reason:"threshold"}`, single visible guidance
   message on unrecoverable sessions, no-op when usage already recovered,
   graceful degradation on hosts without the recovery APIs.
2. Package gate: `bun run test:senpi`
   (= build:senpi-plugin bundle build + `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
   + `bun test packages/omo-senpi` incl. bundle-purity / ordering / runtime audits
   + resolve-evidence-dir script test).
3. Before/after deadlock proof: `.omo/evidence/20260824-6871-compaction-deadlock/before-after-proof.ts`
   (output captured in `before-after-output.txt`). Drives a real
   `session_compact` accepted:false threshold rejection through FakeExtensionAPI
   with and without the component registered.
4. Engine-contract verification (read-only, pinned dist 2026.8.23): confirmed the
   rejection payload shape (`agent-session.js` `_rejectCompaction`), the
   `cancelled-by-extension` cause mapping for extension cancels, and that all five
   context ports used by the component exist on the real runner context
   (`extensions/runner.js` createContext). Confirmed `applyCompaction(precomputed)`
   re-validates overflow via `_wouldCompactionOverflow` before committing.

## WHAT WAS OBSERVED

- Scoped suite: 21 pass / 0 fail (3 files).
- Full senpi gate: 2247 pass / 0 fail / 7 skip (pre-existing skips), build produced
  all six extension bundles; built `plugin/extensions/omo.js` contains the
  compaction-recovery component and the `omo-compaction-recovery:guidance` type.
- Before/after proof:
  - BEFORE (component absent): rejection observed -> 0 applies, 0 guidance
    (the #6871 silent deadlock).
  - AFTER: `applyCompaction CALLED firstKeptEntryId=e0` (earliest safe fitting
    boundary), guidance correctly suppressed because recovery succeeded.
- Typecheck: tsgo clean after crash-recovery fixes (runRescue narrowing param,
  RecoveryUsage fixture shape, ComponentContext config fixture).

## WHY IT IS ENOUGH

The fix is adapter-side glue over a verified host contract: every port and payload
shape was checked against the pinned engine dist rather than assumed, and the
engine independently re-validates any rescue plan (`_wouldCompactionOverflow`,
stale-revision checks) before committing, so a mis-planned rescue cannot corrupt a
session - worst case it is refused, which lands in diagnostics plus one guidance
message. The regression tests pin the exact #6871 family (required-reason +
cancelled-by-extension) and the safety properties (tool-pair-safe boundaries,
conservative budget, once-only guidance). Remaining risk: engine payload drift in
a future pin would degrade to diagnostics-only behavior (all ports optional,
fail-closed narrowing), not to a crash.

## WHAT WAS OMITTED

- Live `senpi` harness drivers (`packages/omo-senpi/scripts/qa/*.mjs`): the
  `senpi` binary is not installed in this environment (`command -v senpi` empty),
  so drivers would report SKIP; per repo rules SKIP is not a pass and is recorded
  here instead of being claimed. Reproducing the real 236k-token deadlock also
  requires a stalled summarization provider and was not attempted.
- Raw log tails from the gate run are summarized above; full raw output was not
  copied to avoid embedding environment paths/tokens. No secrets were involved in
  any command (unit-only, no network, no provider calls).
- Pre-existing dirty submodules under `packages/shared-skills/upstreams/*` were
  restored to their pinned commits solely so the shared-upstream materialize step
  of the gate could run; they are NOT part of this change and are not staged.
