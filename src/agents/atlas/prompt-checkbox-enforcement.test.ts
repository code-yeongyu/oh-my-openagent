import { describe, test, expect } from "bun:test"
import { ATLAS_SYSTEM_PROMPT } from "./default"
import { ATLAS_GPT_SYSTEM_PROMPT } from "./gpt"
import { ATLAS_GEMINI_SYSTEM_PROMPT } from "./gemini"

describe("ATLAS prompt checkbox enforcement", () => {
  describe("default prompt", () => {
    test("plan should NOT be marked (READ ONLY)", () => {
      // given
      const prompt = ATLAS_SYSTEM_PROMPT

      // when / then
      expect(prompt).not.toMatch(/\(READ ONLY\)/)
    })

    test("plan description should include EDIT for checkboxes", () => {
      // given
      const prompt = ATLAS_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/edit.*checkbox|checkbox.*edit/)
    })

    test("boundaries should include exception for editing .sisyphus/plans/*.md checkboxes", () => {
      // given
      const prompt = ATLAS_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/\.sisyphus\/plans\/\*\.md/)
      expect(lowerPrompt).toMatch(/checkbox/)
    })

    test("prompt should include POST-DELEGATION RULE", () => {
      // given
      const prompt = ATLAS_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/post-delegation/)
    })

    test("prompt should include MUST NOT call a new task() before", () => {
      // given
      const prompt = ATLAS_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/must not.*call.*new.*task/)
    })

    test("default prompt should NOT reference .sisyphus/tasks/", () => {
      // given
      const prompt = ATLAS_SYSTEM_PROMPT

      // when / then
      expect(prompt).not.toMatch(/\.sisyphus\/tasks\//)
    })
  })

  describe("GPT prompt", () => {
    test("plan should NOT be marked (READ ONLY)", () => {
      // given
      const prompt = ATLAS_GPT_SYSTEM_PROMPT

      // when / then
      expect(prompt).not.toMatch(/\(READ ONLY\)/)
    })

    test("plan description should include EDIT for checkboxes", () => {
      // given
      const prompt = ATLAS_GPT_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/edit.*checkbox|checkbox.*edit/)
    })

    test("boundaries should include exception for editing .sisyphus/plans/*.md checkboxes", () => {
      // given
      const prompt = ATLAS_GPT_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/\.sisyphus\/plans\/\*\.md/)
      expect(lowerPrompt).toMatch(/checkbox/)
    })

    test("prompt should include POST-DELEGATION RULE", () => {
      // given
      const prompt = ATLAS_GPT_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/post-delegation/)
    })

    test("prompt should include MUST NOT call a new task() before", () => {
      // given
      const prompt = ATLAS_GPT_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/must not.*call.*new.*task/)
    })
  })

  describe("Gemini prompt", () => {
    test("plan should NOT be marked (READ ONLY)", () => {
      // given
      const prompt = ATLAS_GEMINI_SYSTEM_PROMPT

      // when / then
      expect(prompt).not.toMatch(/\(READ ONLY\)/)
    })

    test("plan description should include EDIT for checkboxes", () => {
      // given
      const prompt = ATLAS_GEMINI_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/edit.*checkbox|checkbox.*edit/)
    })

    test("boundaries should include exception for editing .sisyphus/plans/*.md checkboxes", () => {
      // given
      const prompt = ATLAS_GEMINI_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/\.sisyphus\/plans\/\*\.md/)
      expect(lowerPrompt).toMatch(/checkbox/)
    })

    test("prompt should include POST-DELEGATION RULE", () => {
      // given
      const prompt = ATLAS_GEMINI_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/post-delegation/)
    })

    test("prompt should include MUST NOT call a new task() before", () => {
      // given
      const prompt = ATLAS_GEMINI_SYSTEM_PROMPT
      const lowerPrompt = prompt.toLowerCase()

      // when / then
      expect(lowerPrompt).toMatch(/must not.*call.*new.*task/)
    })
  })
})
