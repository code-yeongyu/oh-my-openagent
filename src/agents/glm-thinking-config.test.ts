import { describe, expect, test } from "bun:test"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
import { createOracleAgent } from "./oracle"
import { createSisyphusAgent } from "./sisyphus"
import { createSisyphusJuniorAgentWithOverrides as createSisyphusJuniorAgent } from "./sisyphus-junior/agent"

const GLM_TEXT_MODELS = [
  "z-ai/glm-5",
  "opencode/glm-5",
  "opencode-go/glm-5",
  "zai-coding-plan/glm-5",
  "z-ai/glm-5.1",
  "z-ai/glm-5-turbo",
  "vercel/zai/glm-5",
] as const

const GLM_VISION_MODELS = [
  "opencode/glm-4.6v",
  "zai-coding-plan/glm-4.6v",
  "opencode/glm-5v-turbo",
  "opencode-go/glm5v-turbo",
] as const

const CLAUDE_MODELS = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
] as const

function hasBudgetTokens(thinking: unknown): boolean {
  return typeof thinking === "object"
    && thinking !== null
    && "budgetTokens" in thinking
}

const factories = [
  { name: "Sisyphus", create: (model: string) => createSisyphusAgent(model) },
  { name: "Sisyphus-Junior", create: (model: string) => createSisyphusJuniorAgent({ model }) },
  { name: "Oracle", create: (model: string) => createOracleAgent(model) },
  { name: "Metis", create: (model: string) => createMetisAgent(model) },
  { name: "Momus", create: (model: string) => createMomusAgent(model) },
]

describe("GLM thinking config", () => {
  for (const factory of factories) {
    for (const model of GLM_TEXT_MODELS) {
      test(`#given ${factory.name} with ${model} #when creating agent #then enables thinking without budgetTokens`, () => {
        const config = factory.create(model)

        expect(config.thinking).toEqual({ type: "enabled" })
        expect(hasBudgetTokens(config.thinking)).toBe(false)
      })
    }
  }

  for (const factory of factories) {
    for (const model of GLM_VISION_MODELS) {
      test(`#given ${factory.name} with vision model ${model} #when creating agent #then does not use GLM text thinking path`, () => {
        const config = factory.create(model)

        expect(config.thinking).not.toEqual({ type: "enabled" })
      })
    }
  }

  for (const factory of factories) {
    for (const model of CLAUDE_MODELS) {
      test(`#given ${factory.name} with ${model} #when creating agent #then keeps budgetTokens thinking`, () => {
        const config = factory.create(model)

        expect(hasBudgetTokens(config.thinking)).toBe(true)
      })
    }
  }
})
