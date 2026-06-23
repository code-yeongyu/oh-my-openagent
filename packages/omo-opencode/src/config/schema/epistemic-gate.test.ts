/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { EpistemicGateModeSchema, PreferenceWeightsSchema } from "./epistemic-gate"

describe("EpistemicGateModeSchema", () => {
  describe("#given no input #when parsed #then uses default annotation", () => {
    it("returns annotation", () => {
      expect(EpistemicGateModeSchema.parse(undefined)).toBe("annotation")
    })
  })

  describe("#given gate mode #when parsed #then accepts it", () => {
    it("accepts gate", () => {
      expect(EpistemicGateModeSchema.parse("gate")).toBe("gate")
    })
  })

  describe("#given hybrid mode #when parsed #then accepts it", () => {
    it("accepts hybrid", () => {
      expect(EpistemicGateModeSchema.parse("hybrid")).toBe("hybrid")
    })
  })

  describe("#given dominance mode #when parsed #then accepts it", () => {
    it("accepts dominance", () => {
      expect(EpistemicGateModeSchema.parse("dominance")).toBe("dominance")
    })
  })

  describe("#given invalid mode #when parsed #then rejects it", () => {
    it("rejects invalid values", () => {
      expect(() => EpistemicGateModeSchema.parse("strict")).toThrow()
    })
  })
})

describe("PreferenceWeightsSchema", () => {
  describe("#given no input #when parsed #then uses defaults", () => {
    it("returns default weights", () => {
      const result = PreferenceWeightsSchema.parse({})
      expect(result.logico).toBe(0.6)
      expect(result.probabilistico).toBe(0.4)
      expect(result.etico).toBe(0)
      expect(result.pragmatico).toBe(0)
      expect(result.morale).toBe(0)
    })
  })

  describe("#given old 2-field config #when parsed #then accepts it", () => {
    it("accepts legacy weights", () => {
      const result = PreferenceWeightsSchema.parse({ logico: 0.6, probabilistico: 0.4 })
      expect(result.logico).toBe(0.6)
      expect(result.probabilistico).toBe(0.4)
      expect(result.etico).toBe(0)
      expect(result.pragmatico).toBe(0)
      expect(result.morale).toBe(0)
    })
  })

  describe("#given custom weights summing to 1 #when parsed #then accepts them", () => {
    it("accepts valid weights", () => {
      const result = PreferenceWeightsSchema.parse({
        logico: 0.3,
        probabilistico: 0.2,
        etico: 0.2,
        pragmatico: 0.1,
        morale: 0.2,
      })
      expect(result.logico).toBe(0.3)
      expect(result.probabilistico).toBe(0.2)
      expect(result.etico).toBe(0.2)
      expect(result.pragmatico).toBe(0.1)
      expect(result.morale).toBe(0.2)
    })
  })

  describe("#given partial weights summing to less than 1 #when parsed #then rejects them", () => {
    it("rejects incomplete weights", () => {
      expect(() => PreferenceWeightsSchema.parse({ logico: 0.5, probabilistico: 0.3, etico: 0.1 })).toThrow(
        "preference_weights must sum to 1.0",
      )
    })
  })

  describe("#given all zeros #when parsed #then rejects them", () => {
    it("rejects zero weights", () => {
      expect(() => PreferenceWeightsSchema.parse({ logico: 0, probabilistico: 0, etico: 0, pragmatico: 0, morale: 0 })).toThrow(
        "preference_weights must sum to 1.0",
      )
    })
  })

  describe("#given single full weight #when parsed #then accepts it", () => {
    it("accepts one-hot weights", () => {
      const result = PreferenceWeightsSchema.parse({ logico: 1, probabilistico: 0, etico: 0, pragmatico: 0, morale: 0 })
      expect(result.logico).toBe(1)
      expect(result.probabilistico).toBe(0)
      expect(result.etico).toBe(0)
      expect(result.pragmatico).toBe(0)
      expect(result.morale).toBe(0)
    })
  })

  describe("#given weights not summing to 1 #when parsed #then rejects them", () => {
    it("rejects invalid weights", () => {
      expect(() => PreferenceWeightsSchema.parse({ logico: 0.8, probabilistico: 0.3 })).toThrow(
        "preference_weights must sum to 1.0",
      )
    })
  })
})
