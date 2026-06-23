import { describe, expect, test } from "bun:test"
import type { EpistemicAnnotation } from "./types"
import { evaluateLogico, logicoEvaluator } from "./preference-evaluator-logico"

describe("evaluateLogico", () => {
  describe("#given strict proof chain", () => {
    describe("#when evaluating the score", () => {
      test("#then returns 1.0", () => {
        expect(evaluateLogico("strict")).toBe(1)
      })
    })
  })

  describe("#given defeasible proof chain", () => {
    describe("#when evaluating the score", () => {
      test("#then returns 0.5", () => {
        expect(evaluateLogico("defeasible")).toBe(0.5)
      })
    })
  })

  describe("#given mixed proof chain", () => {
    describe("#when evaluating the score", () => {
      test("#then returns 0.7", () => {
        expect(evaluateLogico("mixed")).toBe(0.7)
      })
    })
  })

  describe("#given unknown proof chain", () => {
    describe("#when evaluating the score", () => {
      test("#then returns 0.3", () => {
        expect(evaluateLogico("unknown")).toBe(0.3)
      })
    })
  })

  describe("#given all known proof chain kinds", () => {
    describe("#when evaluating each score", () => {
      test("#then returns scores between 0.0 and 1.0", () => {
        const kinds: Array<"strict" | "defeasible" | "mixed" | "unknown"> = [
          "strict",
          "defeasible",
          "mixed",
          "unknown",
        ]

        for (const kind of kinds) {
          const score = evaluateLogico(kind)
          expect(score).toBeGreaterThanOrEqual(0)
          expect(score).toBeLessThanOrEqual(1)
        }
      })
    })
  })

  describe("#given the PreferenceEvaluator interface object", () => {
    test("#then exposes the logico evaluator name", () => {
      expect(logicoEvaluator.name).toBe("logico")
    })

    test("#then evaluate returns the same score as evaluateLogico", () => {
      const annotation = {
        proofChainKind: "mixed",
      } as EpistemicAnnotation

      expect(logicoEvaluator.evaluate(annotation)).toBe(evaluateLogico(annotation.proofChainKind))
    })
  })
})
