# WHY IT IS ENOUGH

## Coverage of the issue's acceptance tests

1. "Original objective is initialized once and preserved by updates"
   -> pi store.test.ts (init-once, preserve-across-updates) + omo store.test.ts (same). Both fail on
   the pre-fix code and pass post-fix; they pin the exact regression the issue describes.
2. "Explicit reset replaces the original objective"
   -> pi updateGoal replace-branch test + omo redirected-goal compaction test. The only objective
   mutation paths in both harnesses are explicit user actions (/goal <objective>, controller.setGoal),
   so explicit-reset coverage is exhaustive for objective changes.
3. "Existing version-1 goal files still parse"
   -> raw v1 JSON (no new fields) parsed by both stores; guards stay green before AND after.
4. "Compacted context contains original and current objectives"
   -> THE failing-first regression: `index.test.ts > session.compacted re-anchors the original
   objective as an internal prompt`. Pre-fix, `session.compacted` dispatched nothing (red log proves
   zero captures); post-fix, exactly one prompt carries both objectives inside `<session-goal>`.
   pi-goal is additionally covered at the prompt layer: every continuation/budget-limited hidden
   prompt embeds the anchor, and pi re-queues those prompts after compaction via its existing
   session_start/idle gating, so the compacted context deterministically contains the contract
   without relying on summary fidelity.
5. "Injected goal context is not classified as a genuine latest user message"
   -> assertions pin `synthetic: true`, `isSyntheticOrInternalTextPart`, and
   `hasInternalNoReplyMarker` on the dispatched part - the same markers
   (`packages/utils/src/internal-initiator-marker.ts`) the repo's message-classification helpers use
   to exclude internal prompts from real-user detection. Dispatch itself routes through the mandated
   `dispatchInternalPrompt` gate (reservation + semantic dedupe + queue defer), satisfying the root
   AGENTS.md internal-injection invariant; no raw `session.promptAsync` was added (the repo's static
   route audit scans for exactly that).
6. "Final completion audit can enumerate unresolved original deliverables"
   -> deliverables derived deterministically at creation/reset, preserved across updates, surfaced in
   `<pending_deliverables>` of every anchor and in the machine-consumed tool snapshot
   (`originalObjective`/`deliverables` fields), giving the completion audit a stable enumeration.

## Why unit-level proof is sufficient here

- The omo goal hook is config-gated OFF by default (`goal.enabled`); the changed seam is a pure
  event-case addition whose full dependency chain (event dispatch shape, gate, marker classification)
  is exercised for real in the test through the actual gate implementation, not a mock of it.
- pi-goal per its own AGENTS.md ships standalone; its gate is bun test + tsgo + driver self-test,
  all green (logs in this directory).
- No shared code paths outside the two goal modules were touched; blast radius is bounded by the
  scoped suites plus whole-package typechecks.

## Residual risk

- Live OpenCode TUI/server drive of the goal hook was not performed (see OMITTED); the event-to-dispatch
  path is proven at the module boundary where OpenCode events enter the hook.
