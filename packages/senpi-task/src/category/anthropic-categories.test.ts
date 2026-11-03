/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"
import { FABLE_55_RELEASED } from "@oh-my-opencode/model-core"

const architect = ANTHROPIC_CATEGORIES.find((category) => category.name === "architect")

describe("anthropic builtin categories", () => {
  describe("#given the architect category", () => {
    describe("#when the resolver routes it", () => {
      it("#then it prefers Fable 5.5 at max and accepts either generation", () => {
        expect(architect?.config.model).toBe(FABLE_55_RELEASED ? "anthropic/claude-fable-5-5" : "anthropic/claude-fable-5-1")
        expect(architect?.config.variant).toBe("max")
        expect(architect?.requiresModel).toEqual([...(FABLE_55_RELEASED ? ["claude-fable-5-5"] : []), "claude-fable-5-1"])
      })
    })
  })
})
