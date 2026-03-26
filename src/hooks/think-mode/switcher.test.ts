/// <reference types="bun:test" />

import { describe, test, expect } from "bun:test"
import { getHighVariant, isAlreadyHighVariant } from "./switcher"

describe("Think Mode Switcher — Antigravity Models", () => {
  describe("Antigravity Gemini Models", () => {
    test("maps antigravity-gemini-3-1-pro to high variant", () => {
      const result = getHighVariant("antigravity-gemini-3-1-pro")
      expect(result).toBe("antigravity-gemini-3-1-pro-high")
    })

    test("maps antigravity-gemini-3-flash to high variant", () => {
      const result = getHighVariant("antigravity-gemini-3-flash")
      expect(result).toBe("antigravity-gemini-3-flash-high")
    })

    test("recognizes antigravity-gemini-3-1-pro-high as already high", () => {
      const isHigh = isAlreadyHighVariant("antigravity-gemini-3-1-pro-high")
      expect(isHigh).toBe(true)
    })

    test("recognizes antigravity-gemini-3-flash-high as already high", () => {
      const isHigh = isAlreadyHighVariant("antigravity-gemini-3-flash-high")
      expect(isHigh).toBe(true)
    })

    test("returns null for models that are already high variant", () => {
      const result = getHighVariant("antigravity-gemini-3-1-pro-high")
      expect(result).toBe(null)
    })
  })

  describe("Antigravity Models with Provider Prefix", () => {
    test("preserves google/ prefix when upgrading to high variant", () => {
      const result = getHighVariant("google/antigravity-gemini-3-1-pro")
      expect(result).toBe("google/antigravity-gemini-3-1-pro-high")
    })

    test("handles antigravity models with other custom prefixes", () => {
      const result = getHighVariant("vertex_ai/antigravity-gemini-3-flash")
      expect(result).toBe("vertex_ai/antigravity-gemini-3-flash-high")
    })
  })

  describe("Backward Compatibility", () => {
    test("antigravity models without -high suffix are recognized as non-high", () => {
      const result = isAlreadyHighVariant("antigravity-gemini-3-1-pro")
      expect(result).toBe(false)
    })

    test("models ending in -high are recognized as already high", () => {
      const result = isAlreadyHighVariant("some-model-high")
      expect(result).toBe(true)
    })
  })

  describe("Extended Thinking Support", () => {
    test("antigravity models support extended thinking via high variants", () => {
      const baseModel = "antigravity-gemini-3-1-pro"
      const highVariant = getHighVariant(baseModel)

      expect(highVariant).not.toBe(null)
      expect(highVariant).toMatch(/-high$/)
    })

    test("all antigravity model variants have corresponding high variants", () => {
      const antigravityModels = [
        "antigravity-gemini-3-1-pro",
        "antigravity-gemini-3-flash",
      ]

      antigravityModels.forEach(model => {
        const highVariant = getHighVariant(model)
        expect(highVariant).not.toBe(null)
        expect(highVariant).toMatch(/^antigravity-.*-high$/)
      })
    })
  })

  describe("Integration with Non-Antigravity Models", () => {
    test("standard claude models still work", () => {
      const result = getHighVariant("claude-opus-4-6")
      expect(result).toBe("claude-opus-4-6-high")
    })

    test("standard gemini models still work", () => {
      const result = getHighVariant("gemini-3-1-pro")
      expect(result).toBe("gemini-3-1-pro-high")
    })

    test("gpt models still work", () => {
      const result = getHighVariant("gpt-5-4")
      expect(result).toBe("gpt-5-4-high")
    })
  })
})
