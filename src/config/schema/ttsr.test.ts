import { describe, expect, test } from "bun:test"
import { TtsrConfigSchema } from "./ttsr"

describe("TtsrConfigSchema", () => {
  describe("#given empty config", () => {
    test("#when parse called #then applies defaults", () => {
      const result = TtsrConfigSchema.parse({})

      expect(result).toEqual({
        enabled: false,
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

  describe("#when config is a boolean true", () => {
    describe("#then it expands to full config with defaults", () => {
      test("parses boolean true as enabled with defaults", () => {
        const result = TtsrConfigSchema.safeParse(true)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.enabled).toBe(true)
          expect(result.data.contextMode).toBe("discard")
        }
      })
    })
  })

  describe("#when config is a boolean false", () => {
    describe("#then it expands to disabled config with defaults", () => {
      test("parses boolean false as disabled", () => {
        const result = TtsrConfigSchema.safeParse(false)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.enabled).toBe(false)
        }
      })
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
