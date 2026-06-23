/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import {
  ConfidenceWeightsSchema,
  DominanceThresholdSchema,
  InconclusiveThresholdsSchema,
} from "./epistemic-v5"
import { ReasoningCoreConfigSchema } from "./reasoning-core"

describe("ConfidenceWeightsSchema", () => {
  describe("#given no input #when parsed #then uses defaults that sum to 1", () => {
    it("returns default weights", () => {
      const result = ConfidenceWeightsSchema.parse({})

      expect(result.extensionRatio).toBe(0.4)
      expect(result.proofChainDepth).toBe(0.3)
      expect(result.ruleStrength).toBe(0.3)
      expect(result.extensionRatio + result.proofChainDepth + result.ruleStrength).toBe(1)
    })
  })

  describe("#given custom weights summing to 1 #when parsed #then accepts them", () => {
    it("accepts valid weights", () => {
      const result = ConfidenceWeightsSchema.parse({
        extensionRatio: 0.2,
        proofChainDepth: 0.5,
        ruleStrength: 0.3,
      })

      expect(result.extensionRatio).toBe(0.2)
      expect(result.proofChainDepth).toBe(0.5)
      expect(result.ruleStrength).toBe(0.3)
    })
  })

  describe("#given weights not summing to 1 #when parsed #then rejects them", () => {
    it("rejects invalid weights", () => {
      expect(() =>
        ConfidenceWeightsSchema.parse({
          extensionRatio: 0.5,
          proofChainDepth: 0.3,
          ruleStrength: 0.1,
        }),
      ).toThrow("confidence_weights must sum to 1.0")
    })
  })
})

describe("DominanceThresholdSchema", () => {
  describe("#given no input #when parsed #then uses default threshold", () => {
    it("returns 0.7", () => {
      expect(DominanceThresholdSchema.parse(undefined)).toBe(0.7)
    })
  })
})

describe("InconclusiveThresholdsSchema", () => {
  describe("#given no input #when parsed #then uses defaults", () => {
    it("returns default thresholds", () => {
      const result = InconclusiveThresholdsSchema.parse({})

      expect(result.confidence_min).toBe(0.7)
      expect(result.dominance_margin_min).toBe(0.1)
    })
  })
})

describe("ReasoningCoreConfigSchema", () => {
  describe("#given new epistemic v5 fields #when parsed #then accepts them", () => {
    it("accepts optional fields", () => {
      const result = ReasoningCoreConfigSchema.parse({
        confidence_weights: {
          extensionRatio: 0.4,
          proofChainDepth: 0.3,
          ruleStrength: 0.3,
        },
        dominance_confidence_threshold: 0.7,
        inconclusive_thresholds: {
          confidence_min: 0.7,
          dominance_margin_min: 0.1,
        },
      })

      expect(result.confidence_weights?.extensionRatio).toBe(0.4)
      expect(result.dominance_confidence_threshold).toBe(0.7)
      expect(result.inconclusive_thresholds?.confidence_min).toBe(0.7)
    })
  })
})
