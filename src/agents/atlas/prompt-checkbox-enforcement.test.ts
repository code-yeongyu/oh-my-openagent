import { describe, test, expect } from "bun:test"
import { ATLAS_SYSTEM_PROMPT } from "./default"
import { ATLAS_GPT_SYSTEM_PROMPT } from "./gpt"
import { ATLAS_GEMINI_SYSTEM_PROMPT } from "./gemini"
import { ATLAS_KIMI_SYSTEM_PROMPT } from "./kimi"
import { ATLAS_OPUS_47_SYSTEM_PROMPT } from "./opus-4-7"

const ALL_VARIANTS: Array<[string, string]> = [
  ["default", ATLAS_SYSTEM_PROMPT],
  ["gpt", ATLAS_GPT_SYSTEM_PROMPT],
  ["gemini", ATLAS_GEMINI_SYSTEM_PROMPT],
  ["kimi", ATLAS_KIMI_SYSTEM_PROMPT],
  ["opus-4-7", ATLAS_OPUS_47_SYSTEM_PROMPT],
]

describe("ATLAS prompt checkbox enforcement", () => {
  for (const [name, prompt] of ALL_VARIANTS) {
    describe(`${name} prompt`, () => {
      test("plan should NOT be marked (READ ONLY)", () => {
        expect(prompt).not.toMatch(/\(READ ONLY\)/)
      })

      test("plan description should include EDIT for checkboxes", () => {
        const lowerPrompt = prompt.toLowerCase()
        expect(lowerPrompt).toMatch(/edit.*checkbox|checkbox.*edit/)
      })

      test("boundaries should include exception for editing .sisyphus/plans/*.md checkboxes", () => {
        const lowerPrompt = prompt.toLowerCase()
        expect(lowerPrompt).toMatch(/\.sisyphus\/plans\/\*\.md/)
        expect(lowerPrompt).toMatch(/checkbox/)
      })

      test("prompt should include POST-DELEGATION RULE", () => {
        const lowerPrompt = prompt.toLowerCase()
        expect(lowerPrompt).toMatch(/post-delegation/)
      })

      test("prompt should include MUST NOT call a new task() before", () => {
        const lowerPrompt = prompt.toLowerCase()
        expect(lowerPrompt).toMatch(/must not.*call.*new.*task/)
      })

      test("prompt should NOT reference .sisyphus/tasks/", () => {
        expect(prompt).not.toMatch(/\.sisyphus\/tasks\//)
      })
    })
  }
})
