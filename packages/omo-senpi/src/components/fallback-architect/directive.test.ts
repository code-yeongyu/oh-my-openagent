/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  buildFallbackArchitectReminder,
  FALLBACK_ARCHITECT_DIRECTIVE_TYPE,
  FALLBACK_ARCHITECT_REMINDER_TYPE,
} from "./directive"

describe("fallback-architect directive", () => {
  describe("#given the custom message types", () => {
    describe("#when a consumer reads them", () => {
      it("#then they are the wire values senpi persists", () => {
        expect(FALLBACK_ARCHITECT_DIRECTIVE_TYPE).toBe("omo-fallback-architect:directive")
        expect(FALLBACK_ARCHITECT_REMINDER_TYPE).toBe("omo-fallback-architect:reminder")
      })
    })
  })

  describe("#given a refusal driven fallback between two models", () => {
    describe("#when the compact reminder is built", () => {
      const reminder = buildFallbackArchitectReminder({ from: "anthropic/claude-fable-5" })

      it("#then it names the refused model and the architect route", () => {
        expect(reminder).toContain("anthropic/claude-fable-5")
        expect(reminder).toContain('task(category: "architect")')
      })


    })
  })
})
