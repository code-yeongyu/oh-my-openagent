import { describe, it, expect } from "bun:test"
import { DeliberationResponseSchema } from "./types"

describe("Themis ambiguity disclosure", () => {
  describe("#given a response with multiple preferred extensions", () => {
    const validRequest = {
      id: "amb-001",
      timestamp: new Date().toISOString(),
      problem_statement: "Choose between A and B under ambiguous constraints",
      options: ["A", "B"],
      constraints: [],
      preferences: [],
      requested_semantics: "preferred" as const,
    }

    const multiExtensionResponse = {
      verdict: "multiple_extensions" as const,
      rationale: "Preferred semantics produced 2 extensions. Both A and B are defensible. User must decide.",
      proof_chain: [],
      sidecar_trace: { extensions: ["ext1", "ext2"] },
      provenance: {
        semantics: "preferred",
        iterations: 1,
        timestamp: new Date().toISOString(),
        input_request: validRequest,
      },
      bundle: null,
      extensions: [
        { index: 0, accepted_conclusions: ["A_selected"] },
        { index: 1, accepted_conclusions: ["B_selected"] },
      ],
    }

    it("#then response parses successfully with multiple_extensions verdict", () => {
      const result = DeliberationResponseSchema.safeParse(multiExtensionResponse)
      expect(result.success).toBe(true)
    })

    it("#then bundle is null when multiple extensions exist", () => {
      const result = DeliberationResponseSchema.safeParse(multiExtensionResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.bundle).toBeNull()
      }
    })

    it("#then extensions field contains all extension data", () => {
      const result = DeliberationResponseSchema.safeParse(multiExtensionResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.extensions).toBeDefined()
        expect(result.data.extensions!.length).toBe(2)
      }
    })

    it("#then rationale mentions both options are defensible", () => {
      const result = DeliberationResponseSchema.safeParse(multiExtensionResponse)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.rationale).toContain("defensible")
      }
    })
  })
})
