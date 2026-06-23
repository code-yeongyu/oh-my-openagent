import { describe, expect, test } from "bun:test"

import { PreferenceWeightsSchema } from "../../config/schema/epistemic-gate"
import { evaluateProbabilistico } from "./preference-evaluator-probabilistico"

describe("epistemic-state-interpreter v4 edge cases", () => {
  describe("#given a legacy two-field config", () => {
    test("#when parsed #then it remains valid with zero defaults for new fields", () => {
      const result = PreferenceWeightsSchema.parse({ logico: 0.6, probabilistico: 0.4 })

      expect(result).toEqual({
        logico: 0.6,
        probabilistico: 0.4,
        etico: 0,
        pragmatico: 0,
        morale: 0,
      })
    })
  })

  describe("#given weights summing to 0.9", () => {
    test("#when parsed #then validation rejects the incomplete total", () => {
      expect(() =>
        PreferenceWeightsSchema.parse({
          logico: 0.5,
          probabilistico: 0.3,
          etico: 0.1,
        }),
      ).toThrow("preference_weights must sum to 1.0")
    })
  })

  describe("#given all preference weights at zero", () => {
    test("#when parsed #then validation rejects the zero-sum configuration", () => {
      expect(() =>
        PreferenceWeightsSchema.parse({
          logico: 0,
          probabilistico: 0,
          etico: 0,
          pragmatico: 0,
          morale: 0,
        }),
      ).toThrow("preference_weights must sum to 1.0")
    })
  })

  describe("#given a one-hot preference configuration", () => {
    test("#when parsed #then a single full weight is accepted", () => {
      const result = PreferenceWeightsSchema.parse({
        logico: 1,
        probabilistico: 0,
        etico: 0,
        pragmatico: 0,
        morale: 0,
      })

      expect(result).toEqual({
        logico: 1,
        probabilistico: 0,
        etico: 0,
        pragmatico: 0,
        morale: 0,
      })
    })
  })

  describe("#given zero extensions", () => {
    test("#when probabilistico is evaluated #then it returns zero without division by zero", () => {
      expect(evaluateProbabilistico(0, 0)).toBe(0)
    })
  })
})
