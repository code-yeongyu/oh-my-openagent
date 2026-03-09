declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import { resolveSubagentExecution } from "./subagent-resolver"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import * as logger from "../../shared/logger"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

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

  beforeEach(() => {
    mock.restore()
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
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

  test("normalizes matched agent model string before returning categoryModel", async () => {
    //#given
    const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["grok-3"] },
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
})
