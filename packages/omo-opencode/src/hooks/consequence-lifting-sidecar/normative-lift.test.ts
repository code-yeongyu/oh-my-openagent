import { describe, expect, it } from "bun:test"

import { liftNormativeProfile } from "./normative-lift"
import type { ConsequenceGraph } from "./types"

function liftForConclusion(conclusion: string) {
  const decision = "choose(policy)"
  const graph: ConsequenceGraph = {
    decisions: [decision],
    edges: [
      {
        from: decision,
        to: conclusion,
        relation: "risks",
        attribution: {
          directness: "direct",
          foreseeability: "high",
          controllability: "partial",
          affectsVulnerable: false,
          horizon: "short",
        },
        liftStrength: "medium_lift",
      },
    ],
  }

  return liftNormativeProfile(
    decision,
    graph,
    new Map([[conclusion, { status: "Accepted", pianoA: "plausibile", combined: 0.7, tags: [] }]]),
  )
}

describe("normative lift classifier", () => {
  describe("#given conclusion with @valence:harm:severe tag", () => {
    it("#when classify #then returns burden with severity severe", () => {
      const result = liftForConclusion("@valence:harm:severe keep_existing_behavior")

      expect(result.burdens).toHaveLength(1)
      expect(result.benefits).toHaveLength(0)
      expect(result.burdens[0]?.conclusion).toBe("@valence:harm:severe keep_existing_behavior")
    })
  })

  describe("#given conclusion with @valence:benefit:moderate tag", () => {
    it("#when classify #then returns benefit with severity moderate", () => {
      const result = liftForConclusion("@valence:benefit:moderate keep_existing_behavior")

      expect(result.benefits).toHaveLength(1)
      expect(result.burdens).toHaveLength(0)
      expect(result.benefits[0]?.conclusion).toBe("@valence:benefit:moderate keep_existing_behavior")
    })
  })

  describe("#given conclusion without @valence tag", () => {
    it("#when classify #then returns null valence (neutral)", () => {
      const result = liftForConclusion("neutral_operational_note")

      expect(result).toEqual({ burdens: [], benefits: [] })
    })
  })

  describe("#given conclusion with @valence:harm:unknown_severity", () => {
    it("#when classify #then ignores tag (out of closed vocabulary) returns null", () => {
      const result = liftForConclusion("@valence:harm:unknown_severity neutral_operational_note")

      expect(result).toEqual({ burdens: [], benefits: [] })
    })
  })

  describe("#given existing normative-lift public API call", () => {
    it("#when called with legacy conclusion format #then still works (backward compat)", () => {
      const result = liftForConclusion("risk_of_data_loss")

      expect(result.burdens).toHaveLength(1)
      expect(result.benefits).toHaveLength(0)
      expect(result.burdens[0]?.conclusion).toBe("risk_of_data_loss")
    })
  })
})
