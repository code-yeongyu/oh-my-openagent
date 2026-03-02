import { describe, expect, test } from "bun:test"
import { TtsrConfigSchema } from "./ttsr"

describe("TtsrConfigSchema", () => {
  describe("#given empty config", () => {
    test("#when parse called #then applies defaults", () => {
      const result = TtsrConfigSchema.parse({})

      expect(result).toEqual({
        enabled: true,
        contextMode: "discard",
        interruptMode: "always",
        repeatMode: "once",
        repeatGap: 10,
        maxRetriesPerRule: 3,
      })
    })
  })

  describe("#given valid partial config", () => {
    test("#when parse called #then parses successfully", () => {
      const result = TtsrConfigSchema.parse({
        enabled: false,
        contextMode: "keep",
      })

      expect(result.enabled).toBe(false)
      expect(result.contextMode).toBe("keep")
    })
  })

  describe("#given invalid enum", () => {
    test("#when parse called #then throws zod error", () => {
      expect(() => TtsrConfigSchema.parse({ interruptMode: "invalid" })).toThrow()
    })
  })

  describe("#given repeatGap below minimum", () => {
    test("#when parse called #then throws zod error", () => {
      expect(() => TtsrConfigSchema.parse({ repeatGap: 0 })).toThrow()
    })
  })

  describe("#given maxRetriesPerRule above maximum", () => {
    test("#when parse called #then throws zod error", () => {
      expect(() => TtsrConfigSchema.parse({ maxRetriesPerRule: 11 })).toThrow()
    })
  })
})
