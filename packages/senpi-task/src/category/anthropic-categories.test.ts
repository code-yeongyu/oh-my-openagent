/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"

const architect = ANTHROPIC_CATEGORIES.find((category) => category.name === "architect")

describe("anthropic builtin categories", () => {
  describe("#given the architect category", () => {
    describe("#when the resolver routes it", () => {
      it("#then it prefers Fable 5.2 at max and accepts either generation", () => {
        expect(architect?.config.model).toBe("anthropic/claude-fable-5-2")
        expect(architect?.config.variant).toBe("max")
        expect(architect?.requiresModel).toEqual(["claude-fable-5-2", "claude-fable-5-1"])
      })
    })
  })
})
