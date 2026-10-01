import { describe, expect, test } from "bun:test"

import { ManagerConfigSchema } from "./decision-engine"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("ManagerConfigSchema", () => {
  describe("#given an empty manager config", () => {
    test("#when parsed #then jev defaults are applied", () => {
      // given
      const input = { manager: {} }

      // when
      const result = ManagerConfigSchema.parse(input.manager)

      // then
      expect(result.decision_engine).toBe("jev")
      expect(result.jev.model).toBe("jev-1.13")
      expect(result.jev.base_url).toBe("https://opencode.ai/zen/v1")
      expect(result.jev.confidence_threshold).toBe(0.75)
      expect(result.jev.max_attempts).toBe(5)
      expect(result.jev.circuit_breaker.failures).toBe(3)
      expect(result.jev.circuit_breaker.cooldown_ms).toBe(600_000)
      expect(result.jev.budget.monthly_cap_usd).toBe(2)
      expect(result.jev.budget.warn_at_usd).toBe(1.5)
    })
  })

  describe("#given a fully omitted manager block at the root config", () => {
    test("#when parsed #then manager is optional and omitted without error", () => {
      // when
      const result = OhMyOpenCodeConfigSchema.safeParse({})

      // then
      expect(result.success).toBe(true)
    })
  })

  describe("#given an invalid decision_engine value", () => {
    test("#when parsed #then it is rejected", () => {
      // given
      const input = { decision_engine: "oracle" }

      // when
      const result = ManagerConfigSchema.safeParse(input)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("#given an invalid jev base_url", () => {
    test("#when parsed #then it is rejected", () => {
      // given
      const input = { jev: { base_url: "not-a-url" } }

      // when
      const result = ManagerConfigSchema.safeParse(input)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("#given a confidence_threshold out of range", () => {
    test("#when parsed #then it is rejected", () => {
      // given
      const input = { jev: { confidence_threshold: 1.5 } }

      // when
      const result = ManagerConfigSchema.safeParse(input)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("#given explicit overrides", () => {
    test("#when parsed #then overrides win over defaults", () => {
      // given
      const input = {
        decision_engine: "heuristic",
        jev: { model: "jev-2.0", confidence_threshold: 0.9 },
      }

      // when
      const result = ManagerConfigSchema.parse(input)

      // then
      expect(result.decision_engine).toBe("heuristic")
      expect(result.jev.model).toBe("jev-2.0")
      expect(result.jev.confidence_threshold).toBe(0.9)
      expect(result.jev.base_url).toBe("https://opencode.ai/zen/v1")
    })
  })
})
