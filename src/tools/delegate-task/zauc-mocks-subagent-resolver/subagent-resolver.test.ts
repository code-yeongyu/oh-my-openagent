declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import type { DelegateTaskArgs } from "../types"
import type { ExecutorContext } from "../executor-types"
import * as logger from "../../../shared/logger"
import * as connectedProvidersCache from "../../../shared/connected-providers-cache"

type SubagentResolverModule = typeof import("../subagent-resolver")

async function importFreshSubagentResolverModule(): Promise<SubagentResolverModule> {
  return await import(`../subagent-resolver?test=${Date.now()}-${Math.random()}`)
}

function createBaseArgs(overrides?: Partial<DelegateTaskArgs>): DelegateTaskArgs {
  return {
    description: "Run review",
    prompt: "Review the current changes",
    run_in_background: false,
    load_skills: [],
    subagent_type: "oracle",
    ...overrides,
  }
}

function createExecutorContext(
  agentsFn: () => Promise<unknown>,
  overrides?: Partial<ExecutorContext>,
): ExecutorContext {
  const client = {
    app: {
      agents: agentsFn,
    },
  } as ExecutorContext["client"]

  return {
    client,
    manager: {} as ExecutorContext["manager"],
    directory: "/tmp/test",
    ...overrides,
  }
}

describe("resolveSubagentExecution", () => {
  let logSpy: ReturnType<typeof spyOn> | undefined
  let resolveSubagentExecution: SubagentResolverModule["resolveSubagentExecution"]

  beforeEach(async () => {
    mock.restore()
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
    ;({ resolveSubagentExecution } = await importFreshSubagentResolverModule())
  })

  afterEach(() => {
    logSpy?.mockRestore()
  })

  test("returns delegation error when agent discovery fails instead of silently proceeding", async () => {
    //#given
    const resolverError = new Error("agents API unavailable")
    const args = createBaseArgs()
    const executorCtx = createExecutorContext(async () => {
      throw resolverError
    })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe("Failed to delegate to agent \"oracle\": agents API unavailable")
  })

  test("logs failure details when subagent resolution throws", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "review" })
    const executorCtx = createExecutorContext(async () => {
      throw new Error("network timeout")
    })

    //#when
    await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(logSpy).toHaveBeenCalledTimes(1)
    const callArgs = logSpy?.mock.calls[0]
    expect(callArgs?.[0]).toBe("[delegate-task] Failed to resolve subagent execution")
    expect(callArgs?.[1]).toEqual({
      requestedAgent: "review",
      parentAgent: "sisyphus",
      error: "network timeout",
    })
  })

  test("hides primary agents from task delegation lookups", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "sisyphus" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "sisyphus", mode: "primary" },
      { name: "oracle", mode: "subagent" },
      { name: "metis", mode: "all" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Unknown agent: "sisyphus". Available agents: metis, oracle')
  })

  test("requires explicit all or subagent mode for task-callable agents", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "custom-worker" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "custom-worker" },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Unknown agent: "custom-worker". Available agents: oracle')
  })

  test("normalizes matched agent model string before returning categoryModel", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["grok-3", "gpt-5.3-codex"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "oracle" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "oracle", mode: "subagent", model: "openai/gpt-5.3-codex" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
    cacheSpy.mockRestore()
  })

  test("uses agent override fallback_models for subagent runtime fallback chain", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { quotio: ["claude-haiku-4-5"] },
      connected: ["quotio"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: ["quotio/gpt-5.2", "glm-5(max)"],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.fallbackChain).toEqual([
      { providers: ["quotio"], model: "gpt-5.2", variant: undefined },
      { providers: ["quotio"], model: "glm-5", variant: "max" },
    ])
    cacheSpy.mockRestore()
  })

  test("uses category fallback_models when agent override points at category", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { anthropic: ["claude-haiku-4-5"] },
      connected: ["anthropic"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5" },
      ]),
      {
        agentOverrides: {
          explore: {
            category: "research",
          },
        } as ExecutorContext["agentOverrides"],
        userCategories: {
          research: {
            fallback_models: ["anthropic/claude-haiku-4-5"],
          },
        } as ExecutorContext["userCategories"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.fallbackChain).toEqual([
      { providers: ["anthropic"], model: "claude-haiku-4-5", variant: undefined },
    ])
    cacheSpy.mockRestore()
  })

  test("promotes object-style fallback model settings to categoryModel when subagent fallback becomes initial model", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5-unavailable" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: [
              {
                model: "openai/gpt-5.4 high",
                variant: "low",
                reasoningEffort: "high",
                temperature: 0.2,
                top_p: 0.8,
                maxTokens: 2048,
                thinking: { type: "disabled" },
              },
            ],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "low",
      reasoningEffort: "high",
      temperature: 0.2,
      top_p: 0.8,
      maxTokens: 2048,
      thinking: { type: "disabled" },
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("does not apply object-style fallback settings when the subagent primary model matches directly", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "openai/gpt-5.4-preview" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: [
              {
                model: "openai/gpt-5.4",
                variant: "low",
                reasoningEffort: "high",
              },
            ],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-preview",
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("matches promoted fallback settings after fuzzy model resolution", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5-unavailable" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: [
              {
                model: "openai/gpt-5.4",
                variant: "low",
                reasoningEffort: "high",
                temperature: 0.3,
                top_p: 0.4,
                maxTokens: 2222,
                thinking: { type: "disabled" },
              },
            ],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-preview",
      variant: "low",
      reasoningEffort: "high",
      temperature: 0.3,
      top_p: 0.4,
      maxTokens: 2222,
      thinking: { type: "disabled" },
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("prefers exact promoted fallback match over earlier fuzzy prefix match", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5-unavailable" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: [
              {
                model: "openai/gpt-5.4",
                variant: "low",
                reasoningEffort: "medium",
              },
              {
                model: "openai/gpt-5.4-preview",
                variant: "max",
                reasoningEffort: "high",
              },
            ],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-preview",
      variant: "max",
      reasoningEffort: "high",
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("matches promoted fallback settings when fuzzy resolution extends configured model without hyphen", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4o"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5-unavailable" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: [
              {
                model: "openai/gpt-5.4",
                variant: "low",
                reasoningEffort: "high",
              },
            ],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4o",
      variant: "low",
      reasoningEffort: "high",
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("does not use unavailable matchedAgent.model as fallback for custom subagent", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["minimaxi"])
    const args = createBaseArgs({ subagent_type: "my-custom-agent" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "my-custom-agent", mode: "subagent", model: "minimaxi/MiniMax-M2.7-highspeed" },
      ]),
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel?.modelID).not.toBe("MiniMax-M2.7-highspeed")
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("uses matchedAgent.model as fallback when model is available", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7-highspeed"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["minimaxi"])
    const args = createBaseArgs({ subagent_type: "my-custom-agent" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "my-custom-agent", mode: "subagent", model: "minimaxi/MiniMax-M2.7-highspeed" },
      ]),
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({ providerID: "minimaxi", modelID: "MiniMax-M2.7-highspeed" })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("prefers the most specific prefix match when fallback entries share a prefix", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-4o-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5-unavailable" },
      ]),
      {
        agentOverrides: {
          explore: {
            fallback_models: [
              {
                model: "openai/gpt-4",
                variant: "low",
                reasoningEffort: "medium",
              },
              {
                model: "openai/gpt-4o",
                variant: "max",
                reasoningEffort: "high",
              },
            ],
          },
        } as ExecutorContext["agentOverrides"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-4o-preview",
      variant: "max",
      reasoningEffort: "high",
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("preserves category temperature when fallback entry leaves temperature undefined", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5-unavailable" },
      ]),
      {
        agentOverrides: {
          explore: {
            category: "research",
          },
        } as ExecutorContext["agentOverrides"],
        userCategories: {
          research: {
            fallback_models: [
              {
                model: "openai/gpt-5.4",
                variant: "max",
              },
            ],
            temperature: 0.55,
            top_p: 0.45,
          },
        } as ExecutorContext["userCategories"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "max",
      temperature: 0.55,
      top_p: 0.45,
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })

  test("applies category tuning params in the cold-cache override path", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "openai/gpt-5.4" },
      ]),
      {
        agentOverrides: {
          explore: {
            category: "research",
          },
        } as ExecutorContext["agentOverrides"],
        userCategories: {
          research: {
            model: "openai/gpt-5.4",
            variant: "high",
            temperature: 0.61,
            top_p: 0.62,
            maxTokens: 3200,
            reasoningEffort: "medium",
            thinking: { type: "disabled" },
          },
        } as ExecutorContext["userCategories"],
      }
    )

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "high",
      temperature: 0.61,
      top_p: 0.62,
      maxTokens: 3200,
      reasoningEffort: "medium",
      thinking: { type: "disabled" },
    })
    cacheSpy.mockRestore()
    connectedSpy.mockRestore()
  })
})

describe("resolveSubagentExecution - agent name sanitization", () => {
  let logSpy: ReturnType<typeof spyOn> | undefined
  let resolveSubagentExecution: SubagentResolverModule["resolveSubagentExecution"]

  beforeEach(async () => {
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
    ;({ resolveSubagentExecution } = await importFreshSubagentResolverModule())
  })

  afterEach(() => {
    logSpy?.mockRestore()
  })

  test("strips backslash-wrapped agent names like \\hephaestus\\", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "\\hephaestus\\" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "Hephaestus (Deep Agent)", mode: "subagent", model: "openai/gpt-5.3-codex" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("Hephaestus (Deep Agent)")
    cacheSpy.mockRestore()
  })

  test("strips double-quoted agent names", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: '"oracle"' })
    const executorCtx = createExecutorContext(async () => ([
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("oracle")
    cacheSpy.mockRestore()
  })

  test("strips single-quoted agent names", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "'explore'" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "explore", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("explore")
    cacheSpy.mockRestore()
  })
})
