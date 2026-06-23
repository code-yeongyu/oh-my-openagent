import { describe, expect, test } from "bun:test"
import {
  EthicalValueHierarchySchema,
  MoralContextDefaultsSchema,
  PlausibilitaThresholdSchema,
  PragmaticWeightsSchema,
  TransitionThresholdsSchema,
} from "./epistemic-v6"

describe("epistemic-v6 schema", () => {
  describe("PlausibilitaThresholdSchema", () => {
    test("given no input, when parsed, then defaults to 0.5", () => {
      const value = PlausibilitaThresholdSchema.parse(undefined)

      expect(value).toBe(0.5)
    })

    test("given 0.7, when parsed, then accepts the custom threshold", () => {
      const value = PlausibilitaThresholdSchema.parse(0.7)

      expect(value).toBe(0.7)
    })
  })

  describe("EthicalValueHierarchySchema", () => {
    test("given no input, when parsed, then defaults to 6 ordered values", () => {
      const value = EthicalValueHierarchySchema.parse(undefined)

      expect(value).toHaveLength(6)
      expect(value[0]).toBe("vita_umana")
    })

    test("given a custom hierarchy, when parsed, then accepts the array", () => {
      const value = EthicalValueHierarchySchema.parse(["a", "b", "c"])

      expect(value).toEqual(["a", "b", "c"])
    })
  })

  describe("PragmaticWeightsSchema", () => {
    test("given no input, when parsed, then defaults to asymmetric weights", () => {
      const value = PragmaticWeightsSchema.parse(undefined)

      expect(value.peso_proprio).toBe(0.65)
      expect(value.peso_controparte).toBe(0.35)
    })

    test("given weights that do not sum to 1.0, when parsed, then rejects them", () => {
      const result = PragmaticWeightsSchema.safeParse({ peso_proprio: 0.7, peso_controparte: 0.2 })

      expect(result.success).toBeFalse()
    })
  })

  describe("MoralContextDefaultsSchema", () => {
    test("given no input, when parsed, then defaults the audience to general", () => {
      const value = MoralContextDefaultsSchema.parse(undefined)

      expect(value.default_audience).toBe("general")
      expect(value.require_audience_model).toBeFalse()
    })
  })

  describe("TransitionThresholdsSchema", () => {
    test("given no input, when parsed, then defaults to the expected strengths", () => {
      const value = TransitionThresholdsSchema.parse(undefined)

      expect(value.advancement_min_strength).toBe(1)
      expect(value.retrocession_min_strength).toBe(2)
      expect(value.expulsion_min_strength).toBe(3)
      expect(value.reopening_min_strength).toBe(2)
    })
  })
})
