import { describe, expect, it } from "bun:test"
import { buildDeliberationResponse } from "./deliberation-response-builder"
import { createRequest, createSidecar } from "./deliberation-response-builder.test-helpers"

describe("deliberation-response-builder voi handling", () => {
  describe("#given sidecar with voi.deferRecommended = true", () => {
    describe("#when response built with a selectable bundle", () => {
      it("#then verdict is defer_recommended instead of selected", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        sidecar.voi = {
          result: { score: 0.7, deferRecommended: true, recourseLevel: "irreversible", reasons: ["high_information_value_before_commitment"] },
        }
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
})

        expect(response.verdict).toBe("defer_recommended")
        expect(response.bundle).not.toBeNull()
        expect(response.bundle?.selected_option).toBe("Option A")
        expect(response.voi_analysis).toEqual(sidecar.voi)
      })
    })
  })

  describe("#given sidecar with voi.deferRecommended = false", () => {
    describe("#when response built with a selectable bundle", () => {
      it("#then verdict remains selected", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        sidecar.voi = {
          result: { score: 0.2, deferRecommended: false, recourseLevel: "reversible", reasons: [] },
        }
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.verdict).toBe("selected")
        expect(response.bundle?.selected_option).toBe("Option A")
      })
    })
  })

  describe("#given sidecar with no voi field", () => {
    describe("#when response built with a selectable bundle", () => {
      it("#then verdict remains selected", () => {
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: createSidecar({ primary: ["select_option_a"] }),
        })

        expect(response.verdict).toBe("selected")
      })
    })
  })
})
