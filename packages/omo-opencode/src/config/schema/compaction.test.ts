import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"

import { CompactionConfigSchema } from "./compaction"

describe("CompactionConfigSchema", () => {
  describe("#given empty input", () => {
    test("#when parsed #then it returns all compaction defaults", () => {
      // given
      const input = {}

      // when
      const result = CompactionConfigSchema.parse(input)

      // then
      expect(result).toEqual({
        preemptive_threshold: 0.78,
        cooldown_ms: 60000,
        enabled: true,
      })
    })
  })

  describe("#given preemptive_threshold within range", () => {
    test("#when parsed #then it preserves the provided value", () => {
      // given
      const input = { preemptive_threshold: 0.6 }

      // when
      const result = CompactionConfigSchema.parse(input)

      // then
      expect(result.preemptive_threshold).toBe(0.6)
    })
  })

  describe("#given preemptive_threshold above maximum", () => {
    test("#when parsed #then it throws ZodError", () => {
      // given
      const input = { preemptive_threshold: 2 }

      // when
      let thrownError: unknown
      try {
        CompactionConfigSchema.parse(input)
      } catch (error) {
        thrownError = error
      }

      // then
      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })

  describe("#given cooldown_ms is negative", () => {
    test("#when parsed #then it throws ZodError", () => {
      // given
      const input = { cooldown_ms: -1 }

      // when
      let thrownError: unknown
      try {
        CompactionConfigSchema.parse(input)
      } catch (error) {
        thrownError = error
      }

      // then
      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })

  describe("#given cooldown_ms is fractional", () => {
    test("#when parsed #then it throws ZodError", () => {
      // given
      const input = { cooldown_ms: 1.5 }

      // when
      let thrownError: unknown
      try {
        CompactionConfigSchema.parse(input)
      } catch (error) {
        thrownError = error
      }

      // then
      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })

  describe("#given enabled is omitted", () => {
    test("#when parsed #then enabled defaults to true", () => {
      // given
      const input = { preemptive_threshold: 0.5 }

      // when
      const result = CompactionConfigSchema.parse(input)

      // then
      expect(result.enabled).toBe(true)
    })
  })
})
