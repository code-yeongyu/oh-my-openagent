import { describe, expect, it } from "bun:test"

import { detectContamination } from "./contamination-detector"

describe("detectContamination", () => {
  it("marks circular proof dependencies as framework contamination", () => {
    const result = detectContamination("allow(action)", [{ conclusion: "allow(action)", from: ["allow(action)"] }], [])
    expect(result.level).toBe("high")
    expect(result.axis).toBe("framework")
  })

  it("marks biased or coordinated tags as world contamination", () => {
    const result = detectContamination("market_signal", [], ["biased_source:short_fund", "coordinated_narrative:pump"])
    expect(result.level).toBe("high")
    expect(result.axis).toBe("world")
  })

  describe("#given conclusion with @contam:coi:pharma_sponsor tag", () => {
    describe("#when detectContamination", () => {
      it("#then returns level high with coi axis", () => {
        const result = detectContamination("approve(drug)", [], ["@contam:coi:pharma_sponsor"])

        expect(result).toEqual({
          conclusion: "approve(drug)",
          level: "high",
          axis: "coi",
          reasons: ["@contam:coi:pharma_sponsor"],
        })
      })
    })
  })

  describe("#given conclusion with @contam:severance:evidentiary tag", () => {
    describe("#when detectContamination", () => {
      it("#then returns level medium with severance axis", () => {
        const result = detectContamination("support(policy)", [], ["@contam:severance:evidentiary"])

        expect(result).toEqual({
          conclusion: "support(policy)",
          level: "medium",
          axis: "severance",
          reasons: ["@contam:severance:evidentiary"],
        })
      })
    })
  })

  describe("#given conclusion without any contamination tag", () => {
    describe("#when detectContamination", () => {
      it("#then returns level none", () => {
        const result = detectContamination("support(policy)", [], ["@valence:benefit:mild"])

        expect(result).toEqual({
          conclusion: "support(policy)",
          level: "none",
          axis: null,
          reasons: [],
        })
      })
    })
  })

  describe("#given conclusion with both coi and severance tags", () => {
    describe("#when detectContamination", () => {
      it("#then returns level high (two contam signals)", () => {
        const result = detectContamination("reject(policy)", [], [
          "@contam:coi:pharma_sponsor",
          "@contam:severance:evidentiary",
        ])

        expect(result).toEqual({
          conclusion: "reject(policy)",
          level: "high",
          axis: "coi+severance",
          reasons: ["@contam:coi:pharma_sponsor", "@contam:severance:evidentiary"],
        })
      })
    })
  })
})
