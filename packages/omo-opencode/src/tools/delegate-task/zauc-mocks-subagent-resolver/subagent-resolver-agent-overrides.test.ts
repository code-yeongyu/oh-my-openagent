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

  test("resolves override stored under a config alias bound via prompt_append file stem (#3228)", async () => {
    // given
    readProviderModelsCacheMock.mockReturnValue({
      models: { gitlab: ["duo-chat-sonnet-4-6"] },
      connected: ["gitlab"],
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["gitlab"])
    const args = createBaseArgs({ subagent_type: "technical-writer" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "technical-writer", mode: "subagent" },
      ]),
      {
        agentOverrides: {
          scribe: {
            model: "gitlab/duo-chat-sonnet-4-6",
            prompt_append: "file://./agents/technical-writer.md",
          },
        } as ExecutorContext["agentOverrides"],
      },
    )

    // when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    // then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "gitlab",
      modelID: "duo-chat-sonnet-4-6",
    })
    expect(result.fallbackChain).toBeUndefined()
  })

  test("resolves override stored under a config alias bound via displayName (#3228)", async () => {
    // given
    readProviderModelsCacheMock.mockReturnValue({
      models: { gitlab: ["duo-chat-haiku-4-5"] },
      connected: ["gitlab"],
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["gitlab"])
    const args = createBaseArgs({ subagent_type: "fullstack-engineer" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "fullstack-engineer", mode: "subagent" },
      ]),
      {
        agentOverrides: {
          sentinel: {
            model: "gitlab/duo-chat-haiku-4-5",
            displayName: "Fullstack Engineer",
          },
        } as ExecutorContext["agentOverrides"],
      },
    )

    // when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    // then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toEqual({
      providerID: "gitlab",
      modelID: "duo-chat-haiku-4-5",
    })
  })

  test("prefers the exact config-key override over an alias-bound override", async () => {
    // given
    readProviderModelsCacheMock.mockReturnValue({
      models: { gitlab: ["duo-chat-haiku-4-5"], openai: ["gpt-5.6-sol"] },
      connected: ["gitlab", "openai"],
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["gitlab", "openai"])
    const args = createBaseArgs({ subagent_type: "technical-writer" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "technical-writer", mode: "subagent" },
      ]),
      {
        agentOverrides: {
          scribe: {
            model: "gitlab/duo-chat-sonnet-4-6",
            prompt_append: "file://./agents/technical-writer.md",
          },
          "technical-writer": {
            model: "openai/gpt-5.6-sol",
          },
        } as ExecutorContext["agentOverrides"],
      },
    )

    // when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    // then
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
    })
  })

  test("keeps parent-model inheritance when no override alias binds the runtime agent", async () => {
    // given
    readProviderModelsCacheMock.mockReturnValue({
      models: { gitlab: ["duo-chat-sonnet-4-6"] },
      connected: ["gitlab"],
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["gitlab"])
    const args = createBaseArgs({ subagent_type: "technical-writer" })
    const executorCtx = createExecutorContext(
      async () => ([
        { name: "technical-writer", mode: "subagent" },
      ]),
      {
        agentOverrides: {
          scribe: {
            model: "gitlab/duo-chat-sonnet-4-6",
            prompt_append: "file://./agents/scribe-persona.md",
          },
        } as ExecutorContext["agentOverrides"],
      },
    )

    // when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    // then
    expect(result.error).toBeUndefined()
    expect(result.categoryModel).toBeUndefined()
  })
})
