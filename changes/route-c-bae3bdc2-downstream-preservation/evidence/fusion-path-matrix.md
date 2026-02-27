# R0.5 Fusion Path Matrix (A/B/C)

- Timestamp (UTC): 2026-02-28T00:15:00Z
- Inputs:
  - `evidence/rehearsal-conflicts.md` (R0.2)
  - `evidence/rehearsal-impact-report.md` (R0.3)
  - `required-patches.md` (R0.4)
  - `required-paths.md` (R0.4)
  - `approved-exceptions.md` (R0.4)

## Evidence Baseline Used

- Rehearsal conflict load: **64 literal** + **42 semantic-risk** paths (R0.2).
- Runtime impact volume: **823** non-test runtime TS changes in rescue...recovery range (R0.3).
- Machine-checkable ledger baseline (R0.4):
  - `required-patches=106`
  - `required-paths=106`
  - `proposed_drop=28`
  - `exceptions=28`

## Evaluation Criteria

- **Risk**: probability of runtime behavior loss or policy breach.
- **Effort**: implementation/verification burden to complete fusion.
- **Expected preservation ratio**:
  - **Required Preservation Ratio (RPR)** = expected preserved entries within 106 required ledger entries.
  - **Overall Retention Ratio (ORR)** = expected kept entries if the 28 approved exception drops are applied against the 106-entry ledger.
- **Reversibility**: ability to rollback with low blast radius.

## A/B/C Comparison Matrix

| Path | Strategy | Risk | Effort | Expected Preservation Ratio | Reversibility | Evidence-linked rationale |
|---|---|---|---|---|---|---|
| **A** | **Downstream-preservation priority** (prefer preserving downstream behavior broadly, defer cleanup) | **Medium**: low loss risk on required behavior, but higher drift/noise risk due broad carry-forward | **High**: highest reconciliation/test burden because many non-runtime deltas stay in flow | **RPR: 100%** (106/106)<br>**ORR: ~100%** (minimal drops; keeps most exceptions too) | **Medium**: broad carry-forward raises rollback surface | R0.2 shows 106 conflict-risk targets (64+42) requiring adjudication. R0.3 shows 823 runtime TS changes; preserving broadly reduces immediate loss risk but keeps cleanup debt. |
| **B** | **Baseline-cleanliness priority** (aggressively prune to clean baseline shape first) | **High**: increased chance of under-preserving required semantics when semantic-risk paths are compressed too early | **Medium**: fewer files retained, but heavier proof burden for equivalence on risky rewrites | **RPR: 90-95%** (risk of accidental required loss during aggressive pruning)<br>**ORR: 70-75%** (close to 78/106 if all drops applied plus extra pruning) | **High** for mechanical cleanup; **Low-Medium** for behavior regressions | R0.2 semantic-risk set (42) and R0.3 subsystem hotspots (atlas/todo/session/skills) indicate non-trivial behavior coupling; aggressive cleanliness-first approach raises miss risk. |
| **C** | **Module-white-list hybrid** (required allowlist preserved first; apply only approved drops for non-required/non-runtime paths) | **Low**: policy-aligned gating blocks unapproved required loss | **Medium**: bounded adjudication using existing ledgers and exception list | **RPR: 100%** (106/106 required entries guarded)<br>**ORR: 73.6%** (78/106 after applying 28 approved drops only) | **High**: whitelist + exception ledger enables deterministic rollback and audit | R0.4 provides 1:1 machine-checkable mapping (`RP-xxx`↔`PATH-xxx`) plus exact exception set (28). This directly supports gated fusion where required entries are non-droppable unless equivalence-proven/approved. |

## Recommendation

## ✅ Recommended Path: **C — Module-white-list hybrid**

### Why C is selected (evidence-based)

1. **Direct policy compliance**
   - Required allowlist is preservation priority.
   - Non-required/non-runtime entries can follow cleanliness priority only when explicitly approved.
   - Unapproved required loss is blocked by design.

2. **Best risk-to-effort balance under observed complexity**
   - R0.2 conflict pressure (`64+42`) and R0.3 runtime volume (`823`) make pure A expensive and pure B risky.
   - C narrows effort with pre-approved drops (`28`) while protecting required surface (`106`).

3. **Deterministic governance for R0.6 decision gate**
   - R0.4 already established machine-checkable ledgers and exception parity (`proposed_drop=28`, `exceptions=28`).
   - C can be enforced with simple gate rules: preserve all required IDs, allow only listed exceptions, reject any unapproved required drop.

## Decision Gate Conditions for R0.6

- **Block** if any required ledger entry (`RP-*` / `PATH-*`) is dropped without approved equivalent-rewrite proof.
- **Allow** drops only for `EX-001..EX-028` paths from `approved-exceptions.md`.
- **Require** explicit evidence links for every equivalent-rewrite on required paths (especially delete-modify and semantic-risk clusters).
