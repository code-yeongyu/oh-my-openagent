import { describe, test, expect } from "bun:test"
import { createConfigHandler, resolveCategoryConfig } from "./config-handler"
import type { CategoryConfig, OhMyOpenCodeConfig } from "../config/schema"
import { createModelCacheState } from "../plugin-state"

type RuntimeAgentConfig = {
  name?: string
  mode?: string
  prompt?: string
  model?: unknown
  permission?: Record<string, unknown>
}

function getRuntimeAgents(config: Record<string, unknown>): Record<string, RuntimeAgentConfig> {
  const agents = config.agent
  if (!isRuntimeAgentRecord(agents)) {
    throw new Error("expected config.agent to be populated")
  }
  return agents
}

function isRuntimeAgentRecord(value: unknown): value is Record<string, RuntimeAgentConfig> {
  if (typeof value !== "object" || value === null) {
    return false
  }
  return Object.values(value).every(isRuntimeAgentConfig)
}

function isRuntimeAgentConfig(value: unknown): value is RuntimeAgentConfig {
  return typeof value === "object" && value !== null
}

describe("Prometheus category config resolution", () => {
  test("resolves ultrabrain category config", () => {
    // #given
    const categoryName = "ultrabrain"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.2-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("resolves visual-engineering category config", () => {
    // #given
    const categoryName = "visual-engineering"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/gemini-3-pro")
  })

  test("user categories override default categories", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: {
        model: "google/antigravity-claude-opus-4-5-thinking",
        temperature: 0.1,
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    expect(config?.temperature).toBe(0.1)
  })

  test("returns undefined for unknown category", () => {
    // #given
    const categoryName = "nonexistent-category"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeUndefined()
  })

  test("falls back to default when user category has no entry", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      "visual-engineering": {
        model: "custom/visual-model",
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then - falls back to DEFAULT_CATEGORIES
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.2-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("preserves all category properties (temperature, top_p, tools, etc.)", () => {
    // #given
    const categoryName = "custom-category"
    const userCategories: Record<string, CategoryConfig> = {
      "custom-category": {
        model: "test/model",
        temperature: 0.5,
        top_p: 0.9,
        maxTokens: 32000,
        tools: { tool1: true, tool2: false },
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("test/model")
    expect(config?.temperature).toBe(0.5)
    expect(config?.top_p).toBe(0.9)
    expect(config?.maxTokens).toBe(32000)
    expect(config?.tools).toEqual({ tool1: true, tool2: false })
  })
})

describe("config handler Sisyphus startup agent", () => {
  test("uses Sisyphus when OpenCode falls back to build", async () => {
    // #given
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-5",
    }
    const pluginConfig = {} satisfies OhMyOpenCodeConfig
    const handler = createConfigHandler({
      ctx: { directory: process.cwd() },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })

    // #when
    await handler(config)

    // #then
    const agents = getRuntimeAgents(config)
    expect(agents.build?.name).toBe("sisyphus")
    expect(agents.build?.mode).toBe("primary")
    expect(agents.build?.prompt).toBe(agents.sisyphus?.prompt)
    expect(agents.build?.model).toEqual(agents.sisyphus?.model)
  })
})
