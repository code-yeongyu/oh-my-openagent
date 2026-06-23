import { describe, expect, it } from "bun:test"

import { selectPolicyBundle } from "./bundle-selector"
import type { PolicyBundle } from "./policy-bundle-types"
import type { QualifiedPolicy } from "./types"

function policy(decision: string, coreCombined: number, policyStatus: QualifiedPolicy["profile"]["policyStatus"] = "core_accepted_selectable"): QualifiedPolicy {
  return {
    primaryDecision: decision,
    requiredConditions: [],
    requiredMitigations: [],
    profile: {
      decision,
      coreStatus: "accepted",
      coreCombined,
      framework_certainty: "medium",
      world_certainty: "medium",
      catastrophicGated: false,
      forwardBurdens: [],
      forwardBenefits: [],
      mitigations: [],
      requiredConditions: [],
      policyStatus,
      qualifiers: [],
    },
    alternativesConsidered: [],
    residualRisks: [],
    completeness: { status: "complete", targetDecision: decision, gaps: [], justifiedOmissions: [] },
    implementationSafety: { status: "implementationSafe", violations: [] },
  }
}

describe("selectPolicyBundle", () => {
  it("selects one candidate per slot and respects bundle constraints", () => {
    const bundle: PolicyBundle = {
      slots: [
        { name: "primary", candidates: ["choose_long_conditioned_hedged", "choose_short"], maxSelectable: 1 },
        { name: "timing", candidates: ["choose_two_phase_conditional", "choose_no_trade_wait"], maxSelectable: 1 },
      ],
      constraints: [{ left: "choose_short", right: "choose_two_phase_conditional", kind: "mutually_exclusive" }],
    }

    const result = selectPolicyBundle(bundle, [
      policy("choose_long_conditioned_hedged", 0.7),
      policy("choose_short", 0.9),
      policy("choose_two_phase_conditional", 0.8),
      policy("choose_no_trade_wait", 0.6),
    ])

    expect(result.selectedBySlot.primary).toEqual(["choose_short"])
    expect(result.selectedBySlot.timing).toEqual(["choose_no_trade_wait"])
    expect(result.excluded.some((entry) => entry.decision === "choose_two_phase_conditional" && entry.reason === "blocked by bundle constraint")).toBe(true)
  })
})
