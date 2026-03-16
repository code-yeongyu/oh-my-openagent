/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { buildCoeusAgentConfig } from "./coeus-agent-config-builder"
import type { CategoryConfig } from "../config/schema"
import * as shared from "../shared"

beforeEach(() => {
  spyOn(shared, "readConnectedProvidersCache" as any).mockReturnValue(null)
  spyOn(shared, "fetchAvailableModels" as any).mockResolvedValue(
    new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2"])
  )
})

afterEach(() => {
  ;(shared.readConnectedProvidersCache as any)?.mockRestore?.()
  ;(shared.fetchAvailableModels as any)?.mockRestore?.()
})

describe("buildCoeusAgentConfig", () => {
  test("should return base config with resolved model from AGENT_MODEL_REQUIREMENTS", async () => {
    //#given - no overrides
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: undefined,
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should have base config with model and mode
    expect(result).toBeDefined()
    expect(result.model).toBe("anthropic/claude-opus-4-6")
    expect(result.mode).toBe("all")
    expect(result.prompt).toBeDefined()
    expect(typeof result.prompt).toBe("string")
  })

  test("should apply user model override from pluginCoeusOverride", async () => {
    //#given - user override with custom model
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { model: "openai/gpt-5.2" },
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should use overridden model
    expect(result.model).toBe("openai/gpt-5.2")
  })

  test("should apply variant override from pluginCoeusOverride", async () => {
    //#given - user override with variant
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { variant: "high" },
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should have variant
    expect(result.variant).toBe("high")
  })

  test("should apply temperature override from pluginCoeusOverride", async () => {
    //#given - user override with temperature
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { temperature: 0.5 },
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should have temperature
    expect(result.temperature).toBe(0.5)
  })

  test("should apply thinking override from pluginCoeusOverride", async () => {
    //#given - user override with thinking
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { thinking: { type: "enabled", budgetTokens: 16000 } },
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should have thinking config
    expect(result.thinking).toEqual({ type: "enabled", budgetTokens: 16000 })
  })

  test("should merge category config when category specified", async () => {
    //#given - category with temperature
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: { temperature: 0.2 },
    }
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { category: "ultrabrain" },
      userCategories,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should apply category temperature
    expect(result.temperature).toBe(0.2)
  })

  test("should apply prompt_append from pluginCoeusOverride", async () => {
    //#given - user override with prompt_append
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { prompt_append: "Additional instructions" },
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should append to prompt
    expect(typeof result.prompt).toBe("string")
    expect((result.prompt as string).includes("Additional instructions")).toBe(true)
  })

  test("should preserve description and color from configAgentCoeus", async () => {
    //#given - config with description and color
    const params = {
      configAgentCoeus: { description: "Custom Coeus", color: "#FF0000" },
      pluginCoeusOverride: undefined,
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should preserve description and color
    expect((result.description as string).includes("Custom Coeus")).toBe(true)
    expect(result.color).toBe("#FF0000")
  })

  test("should apply reasoningEffort from category config", async () => {
    //#given - category with reasoningEffort
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: { reasoningEffort: "high" },
    }
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { category: "ultrabrain" },
      userCategories,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should have reasoningEffort
    expect(result.reasoningEffort).toBe("high")
  })

  test("should apply maxTokens from pluginCoeusOverride", async () => {
    //#given - user override with maxTokens
    const params = {
      configAgentCoeus: undefined,
      pluginCoeusOverride: { maxTokens: 8000 },
      userCategories: undefined,
      currentModel: undefined,
    }

    //#when - building config
    const result = await buildCoeusAgentConfig(params)

    //#then - should have maxTokens
    expect(result.maxTokens).toBe(8000)
  })
})
