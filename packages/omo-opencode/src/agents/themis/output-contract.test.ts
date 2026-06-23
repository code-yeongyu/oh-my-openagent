import { describe, it, expect } from "bun:test"
import { DeliberationResponseSchema, DeliberationRequestSchema } from "./types"

describe("DeliberationResponse output contract", () => {
  describe("#given a valid response", () => {
    const validRequest = {
      id: "test-001",
      timestamp: new Date().toISOString(),
      problem_statement: "Choose between A and B",
      options: ["A", "B"],
      constraints: ["must be fast"],
      preferences: [{ superior: "A", inferior: "B" }],
      requested_semantics: "grounded" as const,
    }

    const validResponse = {
      verdict: "selected" as const,
      rationale: "Option A is preferred because it satisfies the speed constraint.",
      proof_chain: [
        { conclusion: "A_selected", from: ["fast_constraint"], rule_id: "r1", rule_kind: "defeasible" }
      ],
      sidecar_trace: { raw: "aspic+ theory here" },
      provenance: {
        semantics: "grounded",
        iterations: 1,
        timestamp: new Date().toISOString(),
        input_request: validRequest,
      },
      bundle: { selected_option: "A" },
    }

    it("#then all 6 required fields are present and valid", () => {
      const result = DeliberationResponseSchema.safeParse(validResponse)
      expect(result.success).toBe(true)
    })

    it("#then verdict is one of the allowed enum values", () => {
      const result = DeliberationResponseSchema.safeParse(validResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        const validVerdicts = ["selected", "no_selectable_bundle", "multiple_extensions", "formalization_failed", "sidecar_internal_error", "unable_to_converge", "refused"]
        expect(validVerdicts).toContain(result.data.verdict)
      }
    })

    it("#then proof_chain is an array", () => {
      const result = DeliberationResponseSchema.safeParse(validResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data.proof_chain)).toBe(true)
      }
    })

    it("#then provenance contains input_request", () => {
      const result = DeliberationResponseSchema.safeParse(validResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.provenance.input_request).toBeDefined()
        const reqResult = DeliberationRequestSchema.safeParse(result.data.provenance.input_request)
        expect(reqResult.success).toBe(true)
      }
    })

    it("#then bundle is null when verdict is no_selectable_bundle", () => {
      const catastrophicResponse = {
        ...validResponse,
        verdict: "no_selectable_bundle" as const,
        rationale: "No selectable bundle: catastrophic risk detected.",
        bundle: null,
      }
      const result = DeliberationResponseSchema.safeParse(catastrophicResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.bundle).toBeNull()
      }
    })
  })

  describe("#given an invalid response", () => {
    it("#then missing verdict field fails validation", () => {
      const invalid = { rationale: "test", proof_chain: [], sidecar_trace: {}, provenance: {}, bundle: null }
      const result = DeliberationResponseSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })

    it("#then missing rationale field fails validation", () => {
      const invalid = { verdict: "selected", proof_chain: [], sidecar_trace: {}, provenance: {}, bundle: null }
      const result = DeliberationResponseSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })
})
