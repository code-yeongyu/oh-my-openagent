import { describe, expect, test } from "bun:test"

import { createSisyphusAgent } from "./sisyphus"
import { createHephaestusAgent, UnsupportedHephaestusModelError } from "./hephaestus"
import { maybeCreateHephaestusConfig } from "./builtin-agents/hephaestus-agent"
import { buildSisyphusJuniorPrompt } from "./sisyphus-junior"
import type { AgentOverrides } from "./types"
import type { CategoryConfig } from "../config/schema"

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

  test("#given non-GPT Hephaestus variants #when rendering prompts #then Hephaestus is rejected", () => {
    // given
    const models = [
      "opencode-go/qwen3.7-plus",
      "opencode-go/qwen3.7PLUS",
      "qwen3.7PLUS",
      "bailian-coding-plan/qwen3.7PLUS",
      "Qwen3.7PLUS",
      "opencode-go/qwen3.6-plus",
    ]

    for (const model of models) {
      // when
      const createAgent = () => createHephaestusAgent(model)

      // then
      expect(createAgent).toThrow(UnsupportedHephaestusModelError)
    }
  })

  test("#given non-GPT Hephaestus override #when plugin config creates the agent #then Hephaestus is not registered", () => {
    // given
    const agentOverrides: AgentOverrides = {
      hephaestus: {
        model: "opencode-go/qwen3.7PLUS",
      },
    }
    const mergedCategories: Record<string, CategoryConfig> = {}

    // when
    const config = maybeCreateHephaestusConfig({
      disabledAgents: [],
      agentOverrides,
      availableModels: new Set(["opencode-go/qwen3.7PLUS"]),
      systemDefaultModel: "opencode-go/qwen3.7PLUS",
      isFirstRunNoCache: false,
      availableAgents: [],
      availableSkills: [],
      availableCategories: [],
      mergedCategories,
      useTaskSystem: false,
    })

    // then
    expect(config).toBeUndefined()
  })
})
