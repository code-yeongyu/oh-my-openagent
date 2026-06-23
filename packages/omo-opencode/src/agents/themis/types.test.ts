import { describe, expect, it } from "bun:test"
import { DeliberationResponseSchema } from "./types.ts"

const baseResponse = {
  verdict: "selected",
  rationale: "accepted",
  proof_chain: [
    {
      conclusion: "selected(bundle_a)",
      from: ["premise_1"],
      rule_id: null,
      rule_kind: "strict",
    },
  ],
  sidecar_trace: {},
  provenance: {
    semantics: "grounded",
    iterations: 1,
    timestamp: "2026-04-11T00:00:00.000Z",
    input_request: {
      id: "req-1",
      timestamp: "2026-04-11T00:00:00.000Z",
      problem_statement: "choose a policy",
      options: ["bundle_a"],
      constraints: [],
      preferences: [],
      requested_semantics: "grounded",
    },
  },
  bundle: {
    selected_option: "bundle_a",
  },
} as const

describe("DeliberationResponseSchema", () => {
  describe("#given response with formalization block", () => {
    it("#when parsed #then accepts formalization provenance", () => {
      const result = DeliberationResponseSchema.safeParse({
        ...baseResponse,
        formalization: {
          model_id: "claude-opus-4",
          prompt_version: "1.0.0",
          schema_version: 1,
          mode: "permissive",
          cache_hit: false,
          iterations_attempted: 1,
        },
      })

      expect(result.success).toBe(true)
      expect(result.success && result.data.formalization?.model_id).toBe("claude-opus-4")
    })
  })

  describe("#given response WITHOUT formalization block (legacy)", () => {
    it("#when parsed #then still accepts", () => {
      const result = DeliberationResponseSchema.safeParse(baseResponse)

      expect(result.success).toBe(true)
    })
  })
})
