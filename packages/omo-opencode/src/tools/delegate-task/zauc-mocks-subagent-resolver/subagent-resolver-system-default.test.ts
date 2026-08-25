/// <reference types="bun-types" />

// Focused sibling test: subagent (subagent_type=...) model resolution must fall back to the
// opencode default/global model (systemDefaultModel) when no user/category/fallback-chain
// model resolves — parity with the category path. Live behavior of resolveModelForDelegateTask
// itself (systemDefaultModel as final step) is covered in ../model-selection.test.ts.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { DelegateTaskArgs } from "../types"
import type { ExecutorContext } from "../executor-types"

type SubagentResolverModule = typeof import("../subagent-resolver")

const logMock = mock((..._args: unknown[]) => {})

const readConnectedProvidersCacheMock = mock(() => null as string[] | null)
const readProviderModelsCacheMock = mock(
  () => null as {
    models: Record<string, string[]>
    connected: string[]
    updatedAt: string
  } | null,
)

const loadUserAgentsMock = mock(() => ({}))
const loadProjectAgentsMock = mock((_directory?: string) => ({}))

async function importFreshSubagentResolverModule(): Promise<SubagentResolverModule> {
  return await import(`../subagent-resolver?test=${Date.now()}-${Math.random()}`)
}

function createBaseArgs(overrides?: Partial<DelegateTaskArgs>): DelegateTaskArgs {
  return {
    description: "Run review",
    prompt: "Review the current changes",
    run_in_background: false,
    load_skills: [],
    ...overrides,
  }
}

function createExecutorContext(
  agentsFn: () => Promise<unknown>,
  overrides?: Partial<ExecutorContext>,
): ExecutorContext {
  const client = {
    app: { agents: agentsFn },
  } as ExecutorContext["client"]

  return {
    client,
    manager: {} as ExecutorContext["manager"],
    directory: "/tmp/test",
    ...overrides,
  }
}

describe("resolveSubagentExecution - system default model fallback", () => {
  let resolveSubagentExecution: SubagentResolverModule["resolveSubagentExecution"]

  beforeEach(async () => {
    mock.restore()
    logMock.mockClear()
    readConnectedProvidersCacheMock.mockReset()
    readProviderModelsCacheMock.mockReset()
    readConnectedProvidersCacheMock.mockReturnValue(null)
    readProviderModelsCacheMock.mockReturnValue(null)
    loadUserAgentsMock.mockReset()
    loadProjectAgentsMock.mockReset()
    loadUserAgentsMock.mockImplementation(() => ({}))
    loadProjectAgentsMock.mockImplementation(() => ({}))
    mock.module("../../../shared/logger", () => ({
      log: logMock,
    }))
    mock.module("../../../shared/connected-providers-cache", () => ({
      readConnectedProvidersCache: readConnectedProvidersCacheMock,
      readProviderModelsCache: readProviderModelsCacheMock,
      hasConnectedProvidersCache: () => readConnectedProvidersCacheMock() !== null,
      hasProviderModelsCache: () => readProviderModelsCacheMock() !== null,
      _resetMemCacheForTesting: () => {},
    }))
    mock.module("../../../features/claude-code-agent-loader/loader", () => ({
      loadUserAgents: loadUserAgentsMock,
      loadProjectAgents: loadProjectAgentsMock,
    }))
    mock.module("../../../features/claude-code-agent-loader", () => ({
      loadUserAgents: loadUserAgentsMock,
      loadProjectAgents: loadProjectAgentsMock,
    }))
    ;({ resolveSubagentExecution } = await importFreshSubagentResolverModule())
  })

  afterEach(() => {
    mock.restore()
  })

  test("#given no reachable agent-default or fallback-chain model and a system default #when delegating #then categoryModel falls back to the opencode default model", async () => {
    //#given - warm cache: only 'minimaxi' connected, agent default model on disconnected 'openai'
    readProviderModelsCacheMock.mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["minimaxi"])
    const args = createBaseArgs({ subagent_type: "oracle" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "oracle", mode: "subagent", model: "openai/gpt-5.5" },
    ]))
    const systemDefaultModel = "openai/gpt-5.4"

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep", {}, systemDefaultModel)

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
  })

  test("#given a reachable agent default model #when delegating #then the agent default wins over the system default", async () => {
    //#given - warm cache: 'openai' connected and the agent's own default is available
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.5"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "oracle" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "oracle", mode: "subagent", model: "openai/gpt-5.5" },
    ]))
    const systemDefaultModel = "openai/gpt-5.4"

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep", {}, systemDefaultModel)

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
  })

  test("#given no system default #when delegating with an unreachable agent default #then categoryModel stays undefined (current behavior)", async () => {
    //#given - warm cache: only 'minimaxi' connected, agent default model on disconnected 'openai'
    readProviderModelsCacheMock.mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["minimaxi"])
    const args = createBaseArgs({ subagent_type: "oracle" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "oracle", mode: "subagent", model: "openai/gpt-5.5" },
    ]))

    //#when - no systemDefaultModel passed (6th arg omitted)
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toBeUndefined()
  })

  test("#given an explicit per-agent model override #when delegating #then the override wins over the system default", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { quotio: ["claude-haiku-4-5"] },
      connected: ["quotio"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["quotio"])
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "explore", mode: "subagent", model: "quotio/claude-haiku-4-5" },
      ]),
      {
        agentOverrides: {
          explore: { model: "quotio/claude-haiku-4-5" },
        } as ExecutorContext["agentOverrides"],
      }
    )
    const systemDefaultModel = "openai/gpt-5.4"

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep", {}, systemDefaultModel)

    //#then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({ providerID: "quotio", modelID: "claude-haiku-4-5" })
  })
})
