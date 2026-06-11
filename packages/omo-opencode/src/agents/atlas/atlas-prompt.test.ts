import { describe, test, expect } from "bun:test"
import { getAtlasPrompt } from "./agent"

const ALL_VARIANTS: Array<[string, string]> = [
  ["default", getAtlasPrompt("anthropic/claude-sonnet-4-6")],
  ["gpt", getAtlasPrompt("openai/gpt-5.5")],
  ["gemini", getAtlasPrompt("google/gemini-3.1-pro")],
  ["kimi", getAtlasPrompt("moonshotai/kimi-k2.6")],
  ["opus-4-7", getAtlasPrompt("anthropic/claude-opus-4-7")],
]

describe("Atlas prompts boulder-completion response", () => {
  test("all variants document the boulder-complete nudge response", () => {
    for (const [name, prompt] of ALL_VARIANTS) {
      expect(prompt, `${name}: missing boulder_completion_response section`).toContain("<boulder_completion_response>")
      expect(prompt, `${name}: missing BOULDER COMPLETE recognition phrase`).toContain("BOULDER COMPLETE")
      expect(prompt, `${name}: missing TOTAL ELAPSED summary field`).toContain("TOTAL ELAPSED")
      expect(prompt, `${name}: missing PER-TASK ELAPSED summary field`).toContain("PER-TASK ELAPSED")
    }
  })
})
