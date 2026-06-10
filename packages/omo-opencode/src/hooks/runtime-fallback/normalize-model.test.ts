import { describe, expect, test } from "bun:test"
import { normalizeModelToCanonicalString } from "./normalize-model"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("normalizeModelToCanonicalString", () => {
  describe("#given a plain string model", () => {
    test("#when called #then it returns the trimmed string", () => {
      // given
      const model = "  anthropic/claude-opus-4-7  "

      // when
      const result = normalizeModelToCanonicalString(model)

      // then
      expect(result).toBe("anthropic/claude-opus-4-7")
    })

    test("#when the string is empty #then it returns undefined", () => {
      // given
      const model = "   "

      // when
      const result = normalizeModelToCanonicalString(model)

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("#given an object-shaped model from session.created", () => {
    test("#when it has id + providerID #then it returns the canonical provider/id string", () => {
      // given
      const model = unsafeTestValue<unknown>({ id: "gpt-5.5-codex", providerID: "openai", variant: "medium" })

      // when
      const result = normalizeModelToCanonicalString(model)

      // then
      expect(result).toBe("openai/gpt-5.5-codex")
    })

    test("#when it exposes modelID instead of id #then it still resolves", () => {
      // given
      const model = unsafeTestValue<unknown>({ modelID: "claude-opus-4-7", providerID: "anthropic" })

      // when
      const result = normalizeModelToCanonicalString(model)

      // then
      expect(result).toBe("anthropic/claude-opus-4-7")
    })

    test("#when providerID is missing #then it returns undefined", () => {
      // given
      const model = unsafeTestValue<unknown>({ id: "gpt-5.5-codex", variant: "medium" })

      // when
      const result = normalizeModelToCanonicalString(model)

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("#given a non-model value", () => {
    test("#when called with undefined #then it returns undefined", () => {
      // given
      const model = undefined

      // when
      const result = normalizeModelToCanonicalString(model)

      // then
      expect(result).toBeUndefined()
    })
  })
})
