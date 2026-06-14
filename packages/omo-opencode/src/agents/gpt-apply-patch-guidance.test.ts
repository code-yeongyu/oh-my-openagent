import { describe, expect, test } from "bun:test"

import { createSisyphusAgent } from "./sisyphus"
import { createHephaestusAgent } from "./hephaestus"
import { buildSisyphusJuniorPrompt } from "./sisyphus-junior"

const GPT_APPLY_PATCH_PHRASE = "Use `apply_patch` for file edits"
const GPT_ONLY_FILE_TOOL_PHRASE = "only file-editing tool available here"

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe("GPT apply_patch prompt guidance", () => {
  test("#given GPT-5.5 Sisyphus #when rendering the prompt #then apply_patch guidance appears once", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const agent = createSisyphusAgent(model)

    // then
    expect(countOccurrences(agent.prompt ?? "", GPT_APPLY_PATCH_PHRASE)).toBe(1)
    expect(agent.prompt).not.toContain(GPT_ONLY_FILE_TOOL_PHRASE)
  })

  test("#given GPT-5.5 Sisyphus-Junior #when rendering the prompt #then apply_patch guidance appears once", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const prompt = buildSisyphusJuniorPrompt(model, false)

    // then
    expect(countOccurrences(prompt, GPT_APPLY_PATCH_PHRASE)).toBe(1)
    expect(prompt).not.toContain(GPT_ONLY_FILE_TOOL_PHRASE)
  })

  test("#given GPT-5.5 Hephaestus #when rendering the prompt #then apply_patch guidance appears once", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const agent = createHephaestusAgent(model)

    // then
    expect(countOccurrences(agent.prompt ?? "", GPT_APPLY_PATCH_PHRASE)).toBe(1)
    expect(agent.prompt).not.toContain(GPT_ONLY_FILE_TOOL_PHRASE)
  })

  test("#given non-GPT Sisyphus variants #when rendering prompts #then GPT-only apply_patch guidance is absent", () => {
    // given
    const models = [
      "opencode-go/kimi-k2.7",
      "moonshotai/kimi-k2.6",
      "anthropic/claude-opus-4-8",
    ]

    for (const model of models) {
      // when
      const agent = createSisyphusAgent(model)

      // then
      expect(agent.prompt).not.toContain(GPT_APPLY_PATCH_PHRASE)
      expect(agent.prompt).not.toContain(GPT_ONLY_FILE_TOOL_PHRASE)
    }
  })
})
