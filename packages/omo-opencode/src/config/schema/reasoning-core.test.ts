import { describe, expect, it } from "bun:test"
import { ReasoningCoreConfigSchema } from "./reasoning-core"

describe("ReasoningCoreConfigSchema", () => {
  describe("#given all fields provided", () => {
    it("#when parsed #then returns provided values", () => {
      const result = ReasoningCoreConfigSchema.parse({
        metacognition_enabled: false,
        obligation_ledger_enabled: false,
        epistemic_interlock_enabled: false,
      })

      expect(result.metacognition_enabled).toBe(false)
      expect(result.obligation_ledger_enabled).toBe(false)
      expect(result.epistemic_interlock_enabled).toBe(false)
    })
  })

  describe("#given empty object", () => {
    it("#when parsed #then defaults all toggles to true", () => {
      const result = ReasoningCoreConfigSchema.parse({})

      expect(result.metacognition_enabled).toBe(true)
      expect(result.obligation_ledger_enabled).toBe(true)
      expect(result.epistemic_interlock_enabled).toBe(true)
    })
  })

  describe("#given one toggle set to false", () => {
    it("#when parsed #then only that toggle is false", () => {
      const result = ReasoningCoreConfigSchema.parse({
        obligation_ledger_enabled: false,
      })

      expect(result.metacognition_enabled).toBe(true)
      expect(result.obligation_ledger_enabled).toBe(false)
      expect(result.epistemic_interlock_enabled).toBe(true)
    })
  })
})
