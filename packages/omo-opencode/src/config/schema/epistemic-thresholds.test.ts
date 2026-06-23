/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { EpistemicThresholdsSchema } from "./epistemic-thresholds"

describe("EpistemicThresholdsSchema", () => {
  describe("#given no input #when parsed #then uses defaults", () => {
    it("returns default values", () => {
      const result = EpistemicThresholdsSchema.parse({})
      expect(result.n).toBe(3)
      expect(result.m).toBe(5)
      expect(result.k).toBe(10)
      expect(result.t).toBe(50)
    })
  })

  describe("#given valid custom values #when parsed #then accepts them", () => {
    it("accepts custom thresholds", () => {
      const result = EpistemicThresholdsSchema.parse({ n: 5, m: 10, k: 20, t: 100 })
      expect(result.n).toBe(5)
      expect(result.m).toBe(10)
      expect(result.k).toBe(20)
      expect(result.t).toBe(100)
    })
  })

  describe("#given n=0 #when parsed #then fails validation", () => {
    it("rejects n=0", () => {
      expect(() => EpistemicThresholdsSchema.parse({ n: 0 })).toThrow()
    })
  })

  describe("#given m less than n #when parsed #then fails validation", () => {
    it("rejects m < n", () => {
      expect(() => EpistemicThresholdsSchema.parse({ n: 10, m: 5, k: 10, t: 50 })).toThrow()
    })
  })

  describe("#given partial input #when parsed #then fills remaining with defaults", () => {
    it("applies defaults for missing fields", () => {
      const result = EpistemicThresholdsSchema.parse({ n: 5 })
      expect(result.n).toBe(5)
      expect(result.m).toBe(5)
      expect(result.k).toBe(10)
      expect(result.t).toBe(50)
    })
  })
})
