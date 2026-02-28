import { describe, expect, test } from "bun:test"
import { ToonCompressionConfigSchema } from "./toon-compression"

describe("ToonCompressionConfigSchema", () => {
  describe("enabled field", () => {
    test("defaults to false when not provided", () => {
      // given
      const config = {}

      // when
      const result = ToonCompressionConfigSchema.parse(config)

      // then
      expect(result.enabled).toBe(false)
    })

    test("accepts enabled as true", () => {
      // given
      const config = { enabled: true }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.enabled).toBe(true)
      }
    })

    test("accepts enabled as false", () => {
      // given
      const config = { enabled: false }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.enabled).toBe(false)
      }
    })

    test("rejects non-boolean enabled", () => {
      // given
      const config = { enabled: "true" }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("threshold field", () => {
    test("defaults to 100 when not provided", () => {
      // given
      const config = {}

      // when
      const result = ToonCompressionConfigSchema.parse(config)

      // then
      expect(result.threshold).toBe(100)
    })

    test("accepts valid threshold value", () => {
      // given
      const config = { threshold: 10000 }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.threshold).toBe(10000)
      }
    })

    test("accepts threshold at minimum value (10)", () => {
      // given
      const config = { threshold: 10 }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.threshold).toBe(10)
      }
    })

    test("rejects threshold below minimum (9)", () => {
      // given
      const config = { threshold: 9 }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })

    test("rejects non-number threshold", () => {
      // given
      const config = { threshold: "5000" }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("combined fields", () => {
    test("accepts both enabled and threshold", () => {
      // given
      const config = { enabled: true, threshold: 8000 }

      // when
      const result = ToonCompressionConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.enabled).toBe(true)
        expect(result.data.threshold).toBe(8000)
      }
    })

    test("applies defaults for omitted fields", () => {
      // given
      const config = { enabled: true }

      // when
      const result = ToonCompressionConfigSchema.parse(config)

      // then
      expect(result.enabled).toBe(true)
      expect(result.threshold).toBe(100)
    })
  })
})
