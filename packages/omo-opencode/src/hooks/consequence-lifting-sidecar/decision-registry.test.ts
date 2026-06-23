import { describe, expect, it } from "bun:test"

import { classifyConclusion, identifyDecisions } from "./decision-registry"

describe("decision-registry", () => {
  describe("classifyConclusion", () => {
    it("treats positive action candidates as decisions", () => {
      expect(classifyConclusion("choose_two_phase_conditional", [])).toBe("decision")
      expect(classifyConclusion("activate_epr7_full_city", [])).toBe("decision")
    })

    it("does not treat negated actions as decisions", () => {
      expect(classifyConclusion("-choose_block_ios54_only", [])).toBe("consequence")
      expect(classifyConclusion("-activate_epr7_full_city", [])).toBe("consequence")
    })
  })

  describe("identifyDecisions", () => {
    it("filters out negated actions from the selectable decision set", () => {
      const decisions = identifyDecisions(new Map([
        ["choose_degraded_safe_mode_bundle", { status: "Accepted" }],
        ["-choose_block_ios54_only", { status: "Accepted" }],
        ["choose_throttle_hot_docs", { status: "Accepted" }],
        ["-activate_epr7_full_city", { status: "Accepted" }],
      ]))

      expect(decisions).toEqual([
        "choose_degraded_safe_mode_bundle",
        "choose_throttle_hot_docs",
      ])
    })
  })
})
