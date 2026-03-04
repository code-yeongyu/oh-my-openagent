import { describe, it, expect } from "bun:test"
import { normalizeModelFormat } from "./model-format-normalizer"

describe("normalizeModelFormat", () => {
  describe("string format input", () => {
    it("splits provider/model format correctly", () => {
      const result = normalizeModelFormat("opencode/glm-5-free")
      expect(result).toEqual({ providerID: "opencode", modelID: "glm-5-free" })
    })

    it("handles provider with multiple slashes", () => {
      const result = normalizeModelFormat("anthropic/claude-opus-4-6/max")
      expect(result).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6/max" })
    })

    it("returns undefined for malformed string without separator", () => {
      const result = normalizeModelFormat("invalid")
      expect(result).toBeUndefined()
    })

    it("returns undefined for empty string", () => {
      const result = normalizeModelFormat("")
      expect(result).toBeUndefined()
    })
  })

  describe("object format input", () => {
    it("passthroughs object format unchanged", () => {
      const input = { providerID: "opencode", modelID: "glm-5-free" }
      const result = normalizeModelFormat(input)
      expect(result).toEqual(input)
    })
  })

  describe("edge cases", () => {
    it("returns undefined for null", () => {
      const result = normalizeModelFormat(null)
      expect(result).toBeUndefined()
    })

    it("returns undefined for undefined", () => {
      const result = normalizeModelFormat(undefined)
      expect(result).toBeUndefined()
    })
  })
})
