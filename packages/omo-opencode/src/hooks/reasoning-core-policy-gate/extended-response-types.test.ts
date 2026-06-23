import { describe, it, expect } from "bun:test"
import type { ExtendedDeliberationFields } from "./extended-response-types"

describe("ExtendedDeliberationFields", () => {
  describe("#given empty object", () => {
    it("#when assigned to type #then all fields undefined (backward compat)", () => {
      const fields: ExtendedDeliberationFields = {}
      expect(fields.semantics_comparison).toBeUndefined()
      expect(fields.epistemic_analysis).toBeUndefined()
      expect(fields.confidence).toBeUndefined()
    })
  })

  describe("#given populated object", () => {
    it("#when assigned #then fields accessible", () => {
      const fields: ExtendedDeliberationFields = {
        semantics_comparison: {
          grounded_set: ["select_f"],
          preferred_extensions: [["select_f"]],
          stable_extensions: [],
          complete_extensions: [["select_f"]],
          certainty_gradient: { certain: ["select_f"], defensible: [], contested: [] },
        },
        epistemic_analysis: {
          piano_c: {
            etico: {
              deontological: { select_f: 1 },
              consequentialist: { select_f: 0.8 },
              virtue_ethics: { select_f: 0.7 },
            },
            morale: {
              select_f: {
                score: 0.9,
                label: "giustificabile",
                contesto_sociale: "general",
                comprensione_destinatari: "general (0.5)",
                impatto_cascata: 0.3,
                intenzione: "benevola",
                trasparenza: 0.8,
                fiducia_risultante: 0.7,
                reason: null,
              },
            },
            pragmatico: {
              select_f: {
                score: 0.6,
                label: "conveniente",
                beneficio_proprio: 0.7,
                beneficio_controparte: 0.5,
                costo_proprio: 0.3,
                costo_controparte: 0.2,
                pesatura: { proprio: 0.6, controparte: 0.4 },
              },
            },
          },
        },
        convergence: "converged",
        confidence: { framework_certainty: 0.9, world_certainty: 0.8 },
      }
      expect(fields.convergence).toBe("converged")
      expect(fields.confidence?.framework_certainty).toBe(0.9)
      expect(fields.epistemic_analysis?.piano_c?.etico?.deontological?.select_f).toBe(1)
    })
  })
})
