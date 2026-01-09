import { describe, test, expect, beforeEach } from "bun:test"
import { createConfigHandler } from "./config-handler"
import type { OhMyOpenCodeConfig } from "../config"

describe("config-handler orchestrator-sisyphus key normalization", () => {
  let mockDeps: any

  beforeEach(() => {
    mockDeps = {
      ctx: { directory: "/test/dir" },
      pluginConfig: {} as OhMyOpenCodeConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    }
  })

  test("orchestrator-sisyphus key present (canonical case)", async () => {
    // #given
    mockDeps.pluginConfig = {
      agents: {
        "orchestrator-sisyphus": { model: "anthropic/claude-opus-4-5" },
      },
    }

    const configHandler = createConfigHandler(mockDeps)
    const config: Record<string, unknown> = {}

    // #when
    await configHandler(config)

    // #then
    const agents = config.agent as Record<string, any>
    expect(agents["orchestrator-sisyphus"]).toBeDefined()
    expect(agents["orchestrator-sisyphus"].model).toBe("anthropic/claude-opus-4-5")
  })

  test("Orchestrator-Sisyphus key present (normalization case)", async () => {
    // #given
    mockDeps.pluginConfig = {
      agents: {
        "Orchestrator-Sisyphus": { model: "anthropic/claude-opus-4-5" },
      } as any,
    }

    const configHandler = createConfigHandler(mockDeps)
    const config: Record<string, unknown> = {}

    // #when
    await configHandler(config)

    // #then
    const agents = config.agent as Record<string, any>
    expect(agents["orchestrator-sisyphus"]).toBeDefined()
    expect(agents["orchestrator-sisyphus"].model).toBe("anthropic/claude-opus-4-5")
  })

  test("both keys present - orchestrator-sisyphus takes priority", async () => {
    // #given
    mockDeps.pluginConfig = {
      agents: {
        "orchestrator-sisyphus": { model: "anthropic/claude-sonnet-4-5", temperature: 0.1 },
        "Orchestrator-Sisyphus": { model: "anthropic/claude-opus-4-5", temperature: 0.5 },
      } as any,
    }

    const configHandler = createConfigHandler(mockDeps)
    const config: Record<string, unknown> = {}

    // #when
    await configHandler(config)

    // #then
    const agents = config.agent as Record<string, any>
    expect(agents["orchestrator-sisyphus"]).toBeDefined()
    expect(agents["orchestrator-sisyphus"].model).toBe("anthropic/claude-sonnet-4-5")
    expect(agents["orchestrator-sisyphus"].temperature).toBe(0.1)
  })

  test("neither key present - uses default model", async () => {
    // #given
    mockDeps.pluginConfig = {
      agents: {},
    }

    const configHandler = createConfigHandler(mockDeps)
    const config: Record<string, unknown> = {}

    // #when
    await configHandler(config)

    // #then
    const agents = config.agent as Record<string, any>
    expect(agents["orchestrator-sisyphus"]).toBeDefined()
    expect(agents["orchestrator-sisyphus"].model).toBe("anthropic/claude-sonnet-4-5")
  })

  test("Orchestrator-Sisyphus with additional config", async () => {
    // #given
    mockDeps.pluginConfig = {
      agents: {
        "Orchestrator-Sisyphus": {
          model: "openai/gpt-5.2",
          temperature: 0.3,
          prompt_append: "Additional instructions",
        },
      } as any,
    }

    const configHandler = createConfigHandler(mockDeps)
    const config: Record<string, unknown> = {}

    // #when
    await configHandler(config)

    // #then
    const agents = config.agent as Record<string, any>
    expect(agents["orchestrator-sisyphus"]).toBeDefined()
    expect(agents["orchestrator-sisyphus"].model).toBe("openai/gpt-5.2")
    expect(agents["orchestrator-sisyphus"].temperature).toBe(0.3)
  })
})
