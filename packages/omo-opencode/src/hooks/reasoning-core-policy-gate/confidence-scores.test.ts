import { describe, expect, it } from "bun:test"
import { extractConfidenceFromSidecar, mapCertaintyToScore } from "./confidence-scores"
import type { SidecarOutput } from "../consequence-lifting-sidecar"

describe("confidence-scores", () => {
  describe("#given mapCertaintyToScore", () => {
    describe("#when called with each certainty level", () => {
      it("#then maps high to 0.85", () => {
        expect(mapCertaintyToScore("high")).toBe(0.85)
      })

      it("#then maps medium to 0.55", () => {
        expect(mapCertaintyToScore("medium")).toBe(0.55)
      })

      it("#then maps low to 0.25", () => {
        expect(mapCertaintyToScore("low")).toBe(0.25)
      })

      it("#then maps null to 0", () => {
        expect(mapCertaintyToScore(null)).toBe(0)
      })

      it("#then maps undefined to 0", () => {
        expect(mapCertaintyToScore(undefined)).toBe(0)
      })
    })
  })

  describe("#given extractConfidenceFromSidecar", () => {
    describe("#when sidecar has selected decision with certainty scores", () => {
      it("#then returns mapped numeric confidence", () => {
        const sidecar: SidecarOutput = {
          policies: [],
          profiles: [
            {
              decision: "select_option_a",
              coreStatus: "accepted",
              coreCombined: 0.8,
              framework_certainty: "high",
              world_certainty: "medium",
              forwardBurdens: [],
              forwardBenefits: [],
              mitigations: [],
              requiredConditions: [],
              policyStatus: "core_accepted_selectable",
              qualifiers: [],
            },
          ],
          graph: { decisions: ["select_option_a"], edges: [] },
          bundle: {
            bundle: { slots: [], constraints: [] },
            selection: { selectedBySlot: { primary: ["select_option_a"] }, excluded: [] },
          },
          catastrophic: { classifications: [] },
          contamination: { results: [] },
        }

        const confidence = extractConfidenceFromSidecar(sidecar)
        expect(confidence).toEqual({ framework_certainty: 0.85, world_certainty: 0.55 })
      })
    })

    describe("#when sidecar is null", () => {
      it("#then returns null", () => {
        expect(extractConfidenceFromSidecar(null)).toBeNull()
      })
    })

    describe("#when sidecar has no selected decision", () => {
      it("#then returns null", () => {
        const sidecar: SidecarOutput = {
          policies: [],
          profiles: [],
          graph: { decisions: [], edges: [] },
          bundle: {
            bundle: { slots: [], constraints: [] },
            selection: { selectedBySlot: {}, excluded: [] },
          },
          catastrophic: { classifications: [] },
          contamination: { results: [] },
        }

        expect(extractConfidenceFromSidecar(sidecar)).toBeNull()
      })
    })

    describe("#when selected profile has null certainties", () => {
      it("#then returns zeros", () => {
        const sidecar: SidecarOutput = {
          policies: [],
          profiles: [
            {
              decision: "select_option_a",
              coreStatus: "accepted",
              coreCombined: 0.5,
              framework_certainty: null,
              world_certainty: null,
              forwardBurdens: [],
              forwardBenefits: [],
              mitigations: [],
              requiredConditions: [],
              policyStatus: "core_accepted_selectable",
              qualifiers: [],
            },
          ],
          graph: { decisions: ["select_option_a"], edges: [] },
          bundle: {
            bundle: { slots: [], constraints: [] },
            selection: { selectedBySlot: { primary: ["select_option_a"] }, excluded: [] },
          },
          catastrophic: { classifications: [] },
          contamination: { results: [] },
        }

        expect(extractConfidenceFromSidecar(sidecar)).toEqual({ framework_certainty: 0, world_certainty: 0 })
      })
    })
  })
})
