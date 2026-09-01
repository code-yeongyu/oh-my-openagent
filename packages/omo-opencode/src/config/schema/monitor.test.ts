import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"

import { MonitorConfigSchema } from "./monitor"

describe("MonitorConfigSchema", () => {
  describe("#given empty input", () => {
    test("#when parsed #then it returns all monitor defaults", () => {
      // given
      const input = {}

      // when
      const result = MonitorConfigSchema.parse(input)

      // then
      expect(result).toEqual({
        enabled: false,
        live_mode_enabled: false,
        max_monitors_per_session: 3,
        max_runtime_ms: 1800000,
        batch_max_lines: 50,
        batch_max_bytes: 16384,
        flush_interval_ms: 1000,
        ring_max_lines: 1000,
        line_max_bytes: 8192,
        pattern_max_length: 512,
      })
    })
  })

  describe("#given flush_interval_ms is below minimum", () => {
    test("#when parsed #then it throws ZodError", () => {
      // given
      const input = { flush_interval_ms: 10 }

      // when
      let thrownError: unknown
      try {
        MonitorConfigSchema.parse(input)
      } catch (error) {
        thrownError = error
      }

      // then
      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })

  describe("#given enabled is omitted", () => {
    test("#when parsed #then enabled defaults to false", () => {
      // given
      const input = { live_mode_enabled: true }

      // when
      const result = MonitorConfigSchema.parse(input)

      // then
      expect(result.enabled).toBe(false)
    })
  })

  describe("#given allowed_commands contains strings", () => {
    test("#when parsed #then it returns the string array", () => {
      // given
      const input = { allowed_commands: ["bun", "npm"] }

      // when
      const result = MonitorConfigSchema.parse(input)

      // then
      expect(result.allowed_commands).toEqual(["bun", "npm"])
    })
  })
})
