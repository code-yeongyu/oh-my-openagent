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
      requested_semantics: "grounded" as const,
    },
  },
  bundle: {
    selected_option: "bundle_a",
  },
}

describe("DeliberationResponseSchema epistemic analysis", () => {
  it("#when epistemic analysis matches piano A-D structure #then schema exposes typed fields", () => {
    const result = DeliberationResponseSchema.safeParse({
      ...baseResponse,
      epistemic_analysis: {
        piano_a: { select_option_a: "plausibile" },
        piano_b: { select_option_a: 0.87 },
        piano_c: {
          etico: {
            deontological: { select_option_a: 1 },
            consequentialist: { select_option_a: 0.8 },
            virtue_ethics: { select_option_a: 0.8 },
          },
          morale: {
            select_option_a: {
              score: 0.8,
              label: "giustificabile",
              contesto_sociale: "general",
              comprensione_destinatari: "high",
              impatto_cascata: 0.2,
              intenzione: "benevola",
              trasparenza: 0.9,
              fiducia_risultante: 0.8,
              reason: "socially_acceptable",
            },
          },
          pragmatico: {
            select_option_a: {
              score: 0.7,
              label: "conveniente",
              beneficio_proprio: 0.7,
              beneficio_controparte: 0.6,
              costo_proprio: 0.1,
              costo_controparte: 0.2,
              pesatura: { proprio: 0.6, controparte: 0.4 },
            },
          },
        },
        piano_d: {
          synthesis: "Dominant conclusion: select_option_a (margin 1.0000).",
          dominant_conclusion: "select_option_a",
          confidence: 0.85,
        },
      },
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.epistemic_analysis?.piano_a).toEqual({
      select_option_a: "plausibile",
    })
    expect(result.success && result.data.epistemic_analysis?.piano_d?.confidence).toBe(0.85)
  })

  it("#when epistemic analysis contains invalid piano_d confidence #then schema rejects it", () => {
    const result = DeliberationResponseSchema.safeParse({
      ...baseResponse,
      epistemic_analysis: {
        piano_d: {
          synthesis: "Dominant conclusion: select_option_a (margin 1.0000).",
          confidence: "high",
        },
      },
    })

    expect(result.success).toBe(false)
  })
})
