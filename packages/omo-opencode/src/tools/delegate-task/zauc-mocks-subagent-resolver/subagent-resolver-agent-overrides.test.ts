import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ExecutorContext } from "../executor-types"
import type { DelegateTaskArgs } from "../types"

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

describe("resolveSubagentExecution agent overrides", () => {
  let resolveSubagentExecution: SubagentResolverModule["resolveSubagentExecution"]

  beforeEach(async () => {
    mock.restore()
    logMock.mockClear()
    readConnectedProvidersCacheMock.mockReset()
    readProviderModelsCacheMock.mockReset()
    readConnectedProvidersCacheMock.mockReturnValue(null)
    readProviderModelsCacheMock.mockReturnValue(null)
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
    ;({ resolveSubagentExecution } = await importFreshSubagentResolverModule())
  })

  afterEach(() => {
    mock.restore()
  })

  test("does not inherit hardcoded fallback chain when agent override uses custom provider model", async () => {
    // given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gemini-3.5-flash-thinking"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
    const args = createBaseArgs({ subagent_type: "oracle" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "oracle", mode: "subagent", model: "anthropic/claude-opus-4-7" },
      ]),
      {
        agentOverrides: {
          oracle: {
            model: "openai/gemini-3.5-flash-thinking",
          },
        } as ExecutorContext["agentOverrides"],
      },
    )

    // when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    // then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gemini-3.5-flash-thinking",
    })
    expect(result.fallbackChain).toBeUndefined()
  })
})
