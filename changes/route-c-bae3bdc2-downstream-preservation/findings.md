# Findings and Patterns — Baseline `bae3bdc2`

## [2026-02-27] Task: R0.1

**Learnings**:
- Verified baseline anchor relationship: `aa012f44^` matches `bae3bdc2` exactly.
- Rehearsal tuple frozen with identified anchor, current target, and candidate source.
- Divergence comparison ranges selected based on pre-wave structural risk and rescue/recovery divergence.

**Decisions**:
- Use `bae3bdc2..aa012f44` for structural risk analysis.
- Use `rescue/pre-merge-bae3bdc2...recovery/remerge-20260226` for preservation sourcing.

## [2026-02-27] Task: R0.2

**Learnings**:
- Pull-in rehearsal in isolated worktree reproduced 64 literal conflicts (`58` content + `6` delete-modify) and zero rename-class conflicts.
- Semantic-risk overlap remains large (`42` paths) even after literal conflict extraction; coexistence policy is required before formal waves.
- Highest-impact conflict clusters are concentrated in `src/hooks/atlas/**`, `src/tools/session-manager/**`, `src/hooks/todo-continuation-enforcer*`, and skill/runtime trigger surfaces.

**Decisions**:
- Preserve rehearsal branch/worktree as disposable evidence-only environment; abort merge after capture to keep baseline branch clean.
- Carry literal conflict table + semantic-risk table forward as mandatory inputs for R0.4 no-loss mapping and R0.5 path matrix.

## [2026-02-27T16:35:00Z] Task: R0.3

**Learnings**:
- Runtime file impact in rehearsal pull-in range is high-volume (`823` non-test TS files changed), so no-loss mapping must prioritize subsystem-driven grouping rather than flat file ordering.
- Highest runtime-risk concentrations are orchestration and continuity surfaces: `hooks/atlas`, `hooks/todo-continuation-enforcer*`, `tools/session-manager`, `hooks/runtime-fallback`, plus skill-trigger plumbing.
- `AGENTS.md` (`30` files), tests (`233` files), and snapshots are likely no-op runtime deltas, but still useful for expected-behavior parity checks.

**Decisions**:
- Use `rehearsal-conflicts.md` as the authoritative literal/semantic baseline (`64` + `42`), then layer quantitative file-status evidence from required git ranges.
- Keep runtime-impact section explicitly non-empty and grouped by subsystem to feed R0.4 no-loss mapping and R0.5 fusion-path decisions.

## [2026-02-28T00:00:00Z] Task: R0.4

**Learnings**:
- A strict 1:1 `RP-xxx` ↔ `PATH-xxx` mapping makes orphan detection deterministic and machine-checkable.
- Treating test/snapshot deltas as `PROPOSED_DROP` while preserving paired implementation paths keeps runtime scope focused without losing auditability.
- Delete/modify conflicts (`src/agents/utils.ts`, `src/cli/doctor/checks/lsp.ts`, `src/hooks/todo-continuation-enforcer.ts`, `src/tools/slashcommand/tools.ts`) are best represented as `EQUIVALENT_REWRITE` until behavior-equivalence evidence is produced.

**Decisions**:
- Preserve all runtime-critical high-risk surfaces identified in R0.3 (Atlas hooks, todo continuation, session manager, builtin skills/runtime trigger surfaces).
- Keep non-`src/**` support paths in ledger only when explicitly needed for governance (`package.json` as `EQUIVALENT_REWRITE`; docs/hygiene as `PROPOSED_DROP`).
- Require every `PROPOSED_DROP` to be represented in `approved-exceptions.md` with explicit rationale and source IDs.

## [2026-02-28T00:15:00Z] Task: R0.5

**Learnings**:
- The strongest decision signal is the combined evidence pattern, not a single metric: R0.2 conflict pressure (`64+42`) + R0.3 runtime volume (`823`) + R0.4 deterministic ledgers (`106/106`, `28/28`).
- Pure downstream-first (A) over-preserves and inflates execution/verification effort; pure cleanliness-first (B) increases required-loss risk in semantic-risk clusters.
- A whitelist hybrid (C) converts policy into enforceable gates: preserve required allowlist first, apply only approved exception drops.

**Decisions**:
- Recommend **Path C (module-white-list hybrid)** as the R0.6 decision-gate input.
- Use dual ratio reporting in governance artifacts: Required Preservation Ratio (RPR) for no-loss compliance, and Overall Retention Ratio (ORR) for cleanup impact visibility.
- Treat any unapproved required loss as blocking, regardless of perceived cleanup benefit.

## [2026-02-28T00:30:00Z] Task: R0.6

**Learnings**:
- User override to **Path A (downstream-first preservation)** despite Path C recommendation.
- Governance for Route C requires deterministic gates that cannot be bypassed by speed or volume pressure.
- Decision gate R0.6 formalizes the policy that unapproved loss of required paths is a blocking failure.

**Decisions**:
- Adopt **Path A** as the formal fusion strategy for Route C.
- Explicitly block Task 0+ entry until R0.6 safety checklist is confirmed.
- Use `required-paths.md` as the authoritative preservation source of truth.

## [2026-02-28T00:45:00Z] Task: R0.7

**Learnings**:
- Acceptance governance needs explicit boolean gates to avoid interpretation drift during formal waves.
- Hard-fail triggers are only audit-safe when represented as deterministic expressions (`count > 0`, `== false`) rather than prose-only intent.
- Wave-level rollback must be checkpoint-bound (A/B/C) so failure behavior is machine-checkable and non-negotiable.

**Decisions**:
- Lock Task 0 prerequisite to `R0.6_DONE && R0.7_DONE`.
- Define three hard-fail triggers as formal booleans: unapproved required item loss, unresolved semantic-risk conflicts, and functional gate failure.
- Block ambiguous acceptance language entirely; acceptance is valid only when all trigger booleans are false and prerequisite gate is true.
- Require deterministic rollback action per wave checkpoint (A/B/C): reset to wave start ref, mark wave rolled back, and block forward progression.

## [2026-02-28] Task: 0

**Learnings**:
- Immutable anchors for Route C are now locked, including the `WAVE_START` and the merge evidence chain.
- The preservation rule is now formal: any missing required item blocks progression unless it has an approved exception.
- The scope is strictly defined to `src/**` runtime paths to prevent scope creep into unrelated documentation or `.qoder/**` churn.

**Decisions**:
- Maintain `approved-exceptions.md` at zero approved drops at Task 0 close.
- Use the defined anchor set for all subsequent wave-level verification.

## [2026-02-28] Task: 1

**Learnings**:
- Initialized the formal Route C execution branch from the pre-merge baseline `bae3bdc2`.
- Confirmed that the baseline relationship to structural risk anchor `aa012f44` is valid for reconstruction.
- Established immutable checkpoint tags for all planned waves to ensure recovery is possible without history mutation.

**Decisions**:
- Use `route-c/bae3bdc2-preserve-downstream` as the primary workspace for all re-fusion waves.
- Set all wave checkpoint tags to the baseline commit initially; they will be updated at the end of each wave execution.

