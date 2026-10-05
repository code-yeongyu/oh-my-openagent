/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"

const architect = ANTHROPIC_CATEGORIES.find((category) => category.name === "architect")

describe("anthropic builtin categories", () => {
  describe("#given the architect category", () => {
    describe("#when a caller reads the description before delegating", () => {
      it("#then it names the model that answers the consultation", () => {
        expect(architect?.description).toContain("Fable 5")
      })

      it("#then it names the content that model is sensitive about", () => {
        expect(architect?.description).toContain("security- and biology-related content")
      })

      it("#then it prescribes the refusal recovery: split indirectly, reason yourself", () => {
        expect(architect?.description).toContain("indirectly-phrased sub-questions")
        expect(architect?.description).toContain("reasoning yourself")
      })
    })

    describe("#when the resolver routes it", () => {
      it("#then it requires fable 5.1 at the max variant", () => {
        expect(architect?.config.model).toBe("anthropic/claude-fable-5-1")
        expect(architect?.config.variant).toBe("max")
        expect(architect?.requiresModel).toBe("claude-fable-5-1")
      })
    })
  })
})
