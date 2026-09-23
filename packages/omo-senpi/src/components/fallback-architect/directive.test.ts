/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  buildFallbackArchitectDirective,
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
    describe("#when the full directive is built", () => {
      const directive = buildFallbackArchitectDirective({
        from: "anthropic/claude-fable-5",
        to: "anthropic/claude-opus-5-5",
      })

      it("#then it names both models", () => {
        expect(directive).toContain("anthropic/claude-fable-5")
        expect(directive).toContain("anthropic/claude-opus-5-5")
      })

      it("#then it routes the model to the architect category", () => {
        expect(directive).toContain('task(category: "architect")')
      })

      it("#then it keeps the same-model caveat because a fable release refused", () => {
        expect(directive).toContain("the same model that just refused")
      })


    })

    describe("#when the refusing model is outside the fable family", () => {
      const directive = buildFallbackArchitectDirective({
        from: "anthropic/claude-opus-5-5",
        to: "kimi-coding/kimi-k3-unlocked",
      })

      it("#then it still names the architect consultant", () => {
        expect(directive).toContain("The architect consultant is Fable 5")
        expect(directive).toContain('task(category: "architect")')
      })

      it("#then it does not claim the consultant is the model that just refused", () => {
        expect(directive).not.toContain("the same model that just refused")
      })
    })

    describe("#when the compact reminder is built", () => {
      const reminder = buildFallbackArchitectReminder({ from: "anthropic/claude-fable-5" })

      it("#then it names the refused model and the architect route", () => {
        expect(reminder).toContain("anthropic/claude-fable-5")
        expect(reminder).toContain('task(category: "architect")')
      })


    })
  })
})
