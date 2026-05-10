/**
 * GLM Thinking Configuration Regression Tests
 *
 * Verifies thinking config across all agents for every GLM model variant.
 *
 * Categories tested:
 * 1. GLM-5+ text models → thinking: { type: "enabled" } (no budgetTokens)
 * 2. GLM VLM models → no thinking override (default path)
 * 3. Claude models → thinking: { type: "enabled", budgetTokens: 32000 }
 * 4. GPT models → reasoningEffort (no thinking)
 */
import { describe, test, expect } from "bun:test"
import { createOracleAgent } from "./oracle"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
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

const GLM_VLM_MODELS = [
  "opencode/glm-4.6v",
  "zai-coding-plan/glm-4.6v",
  "opencode/glm-5v-turbo",
  "opencode-go/glm5v-turbo",
] as const

const CLAUDE_MODELS = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
] as const

const GPT_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
] as const

function hasBudgetTokens(thinking: unknown): boolean {
  return typeof thinking === "object"
    && thinking !== null
    && "budgetTokens" in (thinking as Record<string, unknown>)
}

describe("GLM Thinking Benchmark: Sisyphus", () => {
  for (const model of GLM_TEXT_MODELS) {
    test(`#given ${model} #then thinking enabled without budgetTokens`, () => {
      const config = createSisyphusAgent(model)
      expect(config.thinking).toEqual({ type: "enabled" })
      expect(hasBudgetTokens(config.thinking)).toBe(false)
    })
  }

  for (const model of CLAUDE_MODELS) {
    test(`#given ${model} #then thinking enabled with budgetTokens`, () => {
      const config = createSisyphusAgent(model)
      expect(config.thinking).toBeDefined()
      expect((config.thinking as Record<string, unknown>).type).toBe("enabled")
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of GPT_MODELS) {
    test(`#given ${model} #then uses reasoningEffort not thinking`, () => {
      const config = createSisyphusAgent(model)
      expect(config.reasoningEffort).toBeDefined()
    })
  }
})

describe("GLM Thinking Benchmark: Sisyphus-Junior", () => {
  for (const model of GLM_TEXT_MODELS) {
    test(`#given ${model} #then thinking enabled without budgetTokens`, () => {
      const config = createSisyphusJuniorAgent({ model })
      expect(config.thinking).toEqual({ type: "enabled" })
      expect(hasBudgetTokens(config.thinking)).toBe(false)
    })
  }

  for (const model of CLAUDE_MODELS) {
    test(`#given ${model} #then thinking enabled with budgetTokens`, () => {
      const config = createSisyphusJuniorAgent({ model })
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of GPT_MODELS) {
    test(`#given ${model} #then uses reasoningEffort not thinking`, () => {
      const config = createSisyphusJuniorAgent({ model })
      expect(config.reasoningEffort).toBeDefined()
    })
  }
})

describe("GLM Thinking Benchmark: Oracle", () => {
  for (const model of GLM_TEXT_MODELS) {
    test(`#given ${model} #then thinking enabled without budgetTokens`, () => {
      const config = createOracleAgent(model)
      expect(config.thinking).toEqual({ type: "enabled" })
      expect(hasBudgetTokens(config.thinking)).toBe(false)
    })
  }

  for (const model of GLM_VLM_MODELS) {
    test(`#given ${model} (VLM) #then falls to default thinking with budgetTokens`, () => {
      const config = createOracleAgent(model)
      // VLM models are NOT thinking models, so they get the default path
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of CLAUDE_MODELS) {
    test(`#given ${model} #then thinking enabled with budgetTokens`, () => {
      const config = createOracleAgent(model)
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of GPT_MODELS) {
    test(`#given ${model} #then uses reasoningEffort not thinking`, () => {
      const config = createOracleAgent(model)
      expect(config.reasoningEffort).toBeDefined()
    })
  }
})

describe("GLM Thinking Benchmark: Metis", () => {
  for (const model of GLM_TEXT_MODELS) {
    test(`#given ${model} #then thinking enabled without budgetTokens`, () => {
      const config = createMetisAgent(model)
      expect(config.thinking).toEqual({ type: "enabled" })
      expect(hasBudgetTokens(config.thinking)).toBe(false)
    })
  }

  for (const model of GLM_VLM_MODELS) {
    test(`#given ${model} (VLM) #then falls to default thinking with budgetTokens`, () => {
      const config = createMetisAgent(model)
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of CLAUDE_MODELS) {
    test(`#given ${model} #then thinking enabled with budgetTokens`, () => {
      const config = createMetisAgent(model)
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }
})

describe("GLM Thinking Benchmark: Momus", () => {
  for (const model of GLM_TEXT_MODELS) {
    test(`#given ${model} #then thinking enabled without budgetTokens`, () => {
      const config = createMomusAgent(model)
      expect(config.thinking).toEqual({ type: "enabled" })
      expect(hasBudgetTokens(config.thinking)).toBe(false)
    })
  }

  for (const model of GLM_VLM_MODELS) {
    test(`#given ${model} (VLM) #then falls to default thinking with budgetTokens`, () => {
      const config = createMomusAgent(model)
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of CLAUDE_MODELS) {
    test(`#given ${model} #then thinking enabled with budgetTokens`, () => {
      const config = createMomusAgent(model)
      expect(config.thinking).toBeDefined()
      expect(hasBudgetTokens(config.thinking)).toBe(true)
    })
  }

  for (const model of GPT_MODELS) {
    test(`#given ${model} #then uses reasoningEffort not thinking`, () => {
      const config = createMomusAgent(model)
      expect(config.reasoningEffort).toBeDefined()
    })
  }
})

describe("GLM Thinking Benchmark: Cross-agent budgetTokens guard", () => {
  const agentFactories = [
    { name: "Sisyphus", fn: (m: string) => createSisyphusAgent(m) },
    { name: "Sisyphus-Junior", fn: (m: string) => createSisyphusJuniorAgent({ model: m }) },
    { name: "Oracle", fn: (m: string) => createOracleAgent(m) },
    { name: "Metis", fn: (m: string) => createMetisAgent(m) },
    { name: "Momus", fn: (m: string) => createMomusAgent(m) },
  ]

  for (const agent of agentFactories) {
    for (const model of GLM_TEXT_MODELS) {
      test(`#given ${agent.name} + ${model} #then NEVER receives budgetTokens`, () => {
        const config = agent.fn(model)
        expect(hasBudgetTokens(config.thinking)).toBe(false)
      })
    }
  }
})
