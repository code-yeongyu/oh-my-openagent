import { describe, expect, test } from "bun:test"

import { createHephaestusAgent, UnsupportedHephaestusModelError } from "./hephaestus"
import { maybeCreateHephaestusConfig } from "./builtin-agents/hephaestus-agent"
import type { AgentOverrides } from "./types"
import type { CategoryConfig } from "../config/schema"



describe("Hephaestus model eligibility", () => {
  test("#given non-GPT Hephaestus variants #when rendering prompts #then Hephaestus is rejected", () => {
    // given
    const models = [
      "opencode-go/qwen3.7-plus",
      "opencode-go/qwen3.7PLUS",
      "qwen3.7PLUS",
      "bailian-coding-plan/qwen3.7PLUS",
      "Qwen3.7PLUS",
      "opencode-go/qwen3.5-plus",
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
