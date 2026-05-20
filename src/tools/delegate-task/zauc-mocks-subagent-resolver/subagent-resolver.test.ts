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

type ClaudeCodeAgentRecord = Record<
  string,
  {
    description?: string
    mode?: string
    prompt?: string
    model?: string | { providerID: string; modelID: string }
  }
>

const loadUserAgentsMock = mock((): ClaudeCodeAgentRecord => ({}))
const loadProjectAgentsMock = mock((_directory?: string): ClaudeCodeAgentRecord => ({}))

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

  test("returns delegation error when subagent resolution throws", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "review" })
    const executorCtx = createExecutorContext(async () => {
      throw new Error("network timeout")
    })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Failed to delegate to agent "review": network timeout')
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
    expect(result.error).toBe('Cannot delegate to primary agent "sisyphus" via task. Select that agent directly instead.')
  })

  test("returns explicit error for primary display-name agents", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "Prometheus - Plan Builder" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "Prometheus - Plan Builder", mode: "primary" },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Cannot delegate to primary agent "Prometheus - Plan Builder" via task. Select that agent directly instead.')
  })

  test("allows delegating to a primary agent when allowPrimaryAgentDelegation is enabled (team-mode path)", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { anthropic: ["claude-opus-4-7"] },
      connected: ["anthropic"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "sisyphus" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "\u200BSisyphus - Ultraworker", mode: "primary", model: "anthropic/claude-opus-4-7" },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep", {
      allowPrimaryAgentDelegation: true,
    })

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("\u200BSisyphus - Ultraworker")
  })

  test("allows delegating to Sisyphus-Junior when allowSisyphusJuniorDirect is enabled (team-mode path)", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { anthropic: ["claude-sonnet-4-6"] },
      connected: ["anthropic"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "sisyphus-junior" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "Sisyphus-Junior", mode: "subagent", model: "anthropic/claude-sonnet-4-6" },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep", {
      allowSisyphusJuniorDirect: true,
    })

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("Sisyphus-Junior")
  })

  test("renders a usable fallback hint when categoryExamples is empty for the default Sisyphus-Junior block", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "sisyphus-junior" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "Sisyphus-Junior", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.error).toBeDefined()
    expect(result.error).not.toContain("(e.g., )")
    expect(result.error).toContain("pick one of: quick, deep, ultrabrain")
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

  test("rejects delegation to hidden native execution agents (regression #3957)", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "build" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "build", mode: "subagent", hidden: true },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Unknown agent: "build". Available agents: oracle')
  })

  test("allows delegation to hidden plan agent demoted to subagent", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "plan" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "plan", mode: "subagent", hidden: true },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("plan")
    expect(result.categoryModel).toBeUndefined()
  })

  test("preserves hidden sort-prefixed plan agent model instead of using fallback", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { anthropic: ["claude-opus-4-7"] },
      connected: ["anthropic"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "plan" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "1|plan", mode: "subagent", hidden: true, model: "anthropic/claude-opus-4-7" },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("plan")
    expect(result.categoryModel).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
  })

  test("allows OpenCode-hidden-list plan fallback when planner_enabled and replace_plan are true", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "plan" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "oracle", mode: "subagent" },
    ]), {
      sisyphusAgentConfig: {
        planner_enabled: true,
        replace_plan: true,
      },
    })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("plan")
    expect(result.categoryModel).toBeUndefined()
  })

  test.each([
    { loader: "user", aliasName: "plan" },
    { loader: "user", aliasName: '"plan"' },
    { loader: "project", aliasName: "plan" },
    { loader: "project", aliasName: '"plan"' },
  ])(
    "uses built-in hidden plan fallback when a $loader $aliasName alias exists",
    async ({ loader, aliasName }) => {
      //#given
      readProviderModelsCacheMock.mockReturnValue({
        models: { openai: ["gpt-5.3-codex"] },
        connected: ["openai"],
        updatedAt: "2026-03-03T00:00:00.000Z",
      })

      loadUserAgentsMock.mockImplementation(() => {
        if (loader === "user") {
          return {
            [aliasName]: {
              description: "Colliding plan alias from user agents",
              mode: "subagent",
              model: "openai/gpt-5.3-codex",
            },
          } satisfies ClaudeCodeAgentRecord
        }
        return {}
      })

      loadProjectAgentsMock.mockImplementation(() => {
        if (loader === "project") {
          return {
            [aliasName]: {
              description: "Colliding plan alias from project agents",
              mode: "subagent",
              model: "openai/gpt-5.3-codex",
            },
          } satisfies ClaudeCodeAgentRecord
        }
        return {}
      })

      const args = createBaseArgs({ subagent_type: "plan" })
      const executorCtx = createExecutorContext(async () => ([
        { name: "oracle", mode: "subagent" },
      ]), {
        sisyphusAgentConfig: {
          planner_enabled: true,
          replace_plan: true,
        },
      })

      //#when
      const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

      //#then
      expect(result.error).toBeUndefined()
      expect(result.agentToUse).toBe("plan")
      expect(result.categoryModel).toBeUndefined()
    },
  )

  test.each([
    { loader: "user", aliasName: "plan" },
    { loader: "user", aliasName: '"plan"' },
    { loader: "project", aliasName: "plan" },
    { loader: "project", aliasName: '"plan"' },
  ])(
    "uses built-in hidden plan fallback when a $loader primary $aliasName alias exists",
    async ({ loader, aliasName }) => {
      //#given
      loadUserAgentsMock.mockImplementation(() => {
        if (loader === "user") {
          return {
            [aliasName]: {
              description: "Colliding primary plan alias from user agents",
              mode: "primary",
              model: "openai/gpt-5.3-codex",
            },
          } satisfies ClaudeCodeAgentRecord
        }
        return {}
      })

      loadProjectAgentsMock.mockImplementation(() => {
        if (loader === "project") {
          return {
            [aliasName]: {
              description: "Colliding primary plan alias from project agents",
              mode: "primary",
              model: "openai/gpt-5.3-codex",
            },
          } satisfies ClaudeCodeAgentRecord
        }
        return {}
      })

      const args = createBaseArgs({ subagent_type: "plan" })
      const executorCtx = createExecutorContext(async () => ([
        { name: "oracle", mode: "subagent" },
      ]), {
        sisyphusAgentConfig: {
          planner_enabled: true,
          replace_plan: true,
        },
      })

      //#when
      const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

      //#then
      expect(result.error).toBeUndefined()
      expect(result.agentToUse).toBe("plan")
      expect(result.categoryModel).toBeUndefined()
    },
  )

  test.each([
    { loader: "user", aliasName: "build" },
    { loader: "user", aliasName: '"build"' },
    { loader: "user", aliasName: "1|build" },
    { loader: "user", aliasName: "\u200Bbuild" },
    { loader: "project", aliasName: "build" },
    { loader: "project", aliasName: '"build"' },
    { loader: "project", aliasName: "1|build" },
    { loader: "project", aliasName: "\u200Bbuild" },
  ])(
    "rejects omitted hidden build when a $loader $aliasName alias exists",
    async ({ loader, aliasName }) => {
      //#given
      loadUserAgentsMock.mockImplementation(() => {
        if (loader === "user") {
          return {
            [aliasName]: {
              description: "Colliding hidden build alias from user agents",
              mode: "subagent",
              model: "openai/gpt-5.3-codex",
            },
          } satisfies ClaudeCodeAgentRecord
        }
        return {}
      })

      loadProjectAgentsMock.mockImplementation(() => {
        if (loader === "project") {
          return {
            [aliasName]: {
              description: "Colliding hidden build alias from project agents",
              mode: "subagent",
              model: "openai/gpt-5.3-codex",
            },
          } satisfies ClaudeCodeAgentRecord
        }
        return {}
      })

      const args = createBaseArgs({ subagent_type: "build" })
      const executorCtx = createExecutorContext(async () => ([
        { name: "oracle", mode: "subagent" },
      ]))

      //#when
      const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

      //#then
      expect(result.agentToUse).toBe("")
      expect(result.categoryModel).toBeUndefined()
      expect(result.error).toBe('Unknown agent: "build". Available agents: oracle')
    },
  )

  test("preserves a visible server plan agent instead of using fallback", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.3-codex"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "plan" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "plan", mode: "subagent", model: "openai/gpt-5.3-codex" },
      { name: "oracle", mode: "subagent" },
    ]), {
      sisyphusAgentConfig: {
        planner_enabled: true,
        replace_plan: true,
      },
    })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("plan")
    expect(result.categoryModel).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
  })

  test.each([
    [{ planner_enabled: false, replace_plan: true }],
    [{ planner_enabled: true, replace_plan: false }],
  ])(
    "does not allow hidden plan fallback when planner config blocks replacement (%j)",
    async (sisyphusAgentConfig) => {
      //#given
      const args = createBaseArgs({ subagent_type: "plan" })
      const executorCtx = createExecutorContext(async () => ([
        { name: "oracle", mode: "subagent" },
      ]), {
        sisyphusAgentConfig,
      })

      //#when
      const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

      //#then
      expect(result.agentToUse).toBe("")
      expect(result.categoryModel).toBeUndefined()
      expect(result.error).toBe('Unknown agent: "plan". Available agents: oracle')
    },
  )

  test("hidden agents are excluded from error hints except callable demoted plan", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "nonexistent" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "build", mode: "subagent", hidden: true },
      { name: "plan", mode: "subagent", hidden: true },
      { name: "oracle", mode: "subagent" },
      { name: "explore", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Available agents: explore, oracle, plan')
    expect(result.error).not.toContain("build")
  })

  test("rejects ZWSP-prefixed project agent that canonicalizes to hidden build (regression #3957 canonical-key bypass)", async () => {
    //#given
    loadProjectAgentsMock.mockImplementation(() => ({
      "\u200Bbuild": {
        description: "Aliases hidden build via zero-width prefix",
        mode: "subagent",
        prompt: "rogue",
      },
    }))
    const args = createBaseArgs({ subagent_type: "build" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "build", mode: "subagent", hidden: true },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Unknown agent: "build". Available agents: oracle')
  })

  test("uses built-in hidden plan instead of quoted user agent alias", async () => {
    //#given
    loadUserAgentsMock.mockImplementation(() => ({
      '"plan"': {
        description: "Aliases hidden plan via quote wrappers",
        mode: "subagent",
        prompt: "rogue",
      },
    }))
    const args = createBaseArgs({ subagent_type: "plan" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "plan", mode: "subagent", hidden: true },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("plan")
    expect(result.categoryModel).toBeUndefined()
  })

  test("rejects sort-prefixed project agent that canonicalizes to hidden build (regression #3957 canonical-key bypass)", async () => {
    //#given
    loadProjectAgentsMock.mockImplementation(() => ({
      "1|build": {
        description: "Aliases hidden build via sort prefix",
        mode: "subagent",
        prompt: "rogue",
      },
    }))
    const args = createBaseArgs({ subagent_type: "build" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "build", mode: "subagent", hidden: true },
      { name: "oracle", mode: "subagent" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    expect(result.error).toBe('Unknown agent: "build". Available agents: oracle')
  })

  test("normalizes matched agent model string before returning categoryModel", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
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
  })

  test("matches agents even when zero-width characters are present in the requested name", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "\uFEFFSisyphus - Ultraworker" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "\u200BSisyphus - Ultraworker", mode: "subagent", model: "openai/gpt-5.3-codex" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "oracle", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("Sisyphus - Ultraworker")
  })

  test("uses agent override fallback_models for subagent runtime fallback chain", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
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
  })

  test("uses category fallback_models when agent override points at category", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
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
  })

  test("promotes object-style fallback model settings to categoryModel when subagent fallback becomes initial model", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("does not apply object-style fallback settings when the subagent primary model matches directly", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("matches promoted fallback settings after fuzzy model resolution", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("prefers exact promoted fallback match over earlier fuzzy prefix match", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("matches promoted fallback settings when fuzzy resolution extends configured model without hyphen", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4o"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("does not use unavailable matchedAgent.model as fallback for custom subagent", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["minimaxi"])
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
  })

  test("uses matchedAgent.model as fallback when model is available", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7-highspeed"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["minimaxi"])
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
  })

  test("prefers the most specific prefix match when fallback entries share a prefix", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-4o-preview"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("preserves category temperature when fallback entry leaves temperature undefined", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
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
  })

  test("applies category tuning params in the cold-cache override path", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue([])
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
  })

  test("resolves user agent from loadUserAgents when calling task(subagent_type=...)", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
    loadUserAgentsMock.mockImplementation(() => ({
      "my-user-agent": {
        description: "A user agent",
        mode: "subagent",
        prompt: "Do something",
        model: "openai/gpt-5.4",
      },
    }))
    const args = createBaseArgs({ subagent_type: "my-user-agent" })
    const executorCtx = createExecutorContext(async () => [])

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("my-user-agent")
    expect(result.categoryModel?.modelID).toBe("gpt-5.4")
  })

  test("resolves project agent from loadProjectAgents when calling task(subagent_type=...)", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { anthropic: ["claude-sonnet-4"] },
      connected: ["anthropic"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["anthropic"])
    loadProjectAgentsMock.mockImplementation(() => ({
      "my-project-agent": {
        description: "A project agent",
        mode: "subagent",
        prompt: "Do project work",
        model: "anthropic/claude-sonnet-4",
      },
    }))
    const args = createBaseArgs({ subagent_type: "my-project-agent" })
    const executorCtx = createExecutorContext(async () => [])

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("my-project-agent")
    expect(result.categoryModel?.modelID).toBe("claude-sonnet-4")
  })

  test("server agent takes precedence over user agent with same name", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { openai: ["gpt-5.4", "gpt-3.5"] },
      connected: ["openai"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["openai"])
    loadUserAgentsMock.mockImplementation(() => ({
      "explore": {
        description: "User explore agent",
        mode: "subagent",
        prompt: "User prompt",
        model: "openai/gpt-3.5",
      },
    }))
    const args = createBaseArgs({ subagent_type: "explore" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "explore", mode: "subagent", model: "openai/gpt-5.4" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("explore")
    expect(result.categoryModel?.modelID).toBe("gpt-5.4")
  })

  test("project agent takes precedence over user agent with same name", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: { minimaxi: ["MiniMax-M2.7-highspeed", "claude-3-haiku"] },
      connected: ["minimaxi"],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    readConnectedProvidersCacheMock.mockReturnValue(["minimaxi"])
    loadUserAgentsMock.mockImplementation(() => ({
      "my-custom-agent": {
        description: "User agent",
        mode: "subagent",
        prompt: "User prompt",
        model: "minimaxi/claude-3-haiku",
      },
    }))
    loadProjectAgentsMock.mockImplementation(() => ({
      "my-custom-agent": {
        description: "Project agent",
        mode: "subagent",
        prompt: "Project prompt",
        model: "minimaxi/MiniMax-M2.7-highspeed",
      },
    }))
    const args = createBaseArgs({ subagent_type: "my-custom-agent" })
    const executorCtx = createExecutorContext(async () => [])

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("my-custom-agent")
    expect(result.categoryModel?.modelID).toBe("MiniMax-M2.7-highspeed")
  })

  test("filters out primary agents from user/project when resolving", async () => {
    //#given
    loadUserAgentsMock.mockImplementation(() => ({
      "my-primary-agent": {
        description: "A primary agent",
        mode: "primary",
        prompt: "I am primary",
      },
    }))
    const args = createBaseArgs({ subagent_type: "my-primary-agent" })
    const executorCtx = createExecutorContext(async () => [])

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBe('Cannot delegate to primary agent "my-primary-agent" via task. Select that agent directly instead.')
    expect(result.agentToUse).toBe("")
  })
})

describe("resolveSubagentExecution - agent name sanitization", () => {
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

  test("strips backslash-wrapped agent names like \\hephaestus\\", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "\\hephaestus\\" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "Hephaestus - Deep Agent", mode: "subagent", model: "openai/gpt-5.3-codex" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("Hephaestus - Deep Agent")
  })

  test("strips double-quoted agent names", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
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
  })

  test("strips single-quoted agent names", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
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
  })

  test("matches runtime agent names that include invisible sort prefixes", async () => {
    //#given
    readProviderModelsCacheMock.mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "Sisyphus - Ultraworker" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "\u200BSisyphus - Ultraworker", mode: "subagent", model: "openai/gpt-5.3-codex" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "oracle", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("Sisyphus - Ultraworker")
  })

  test("strips legacy ZWSP-prefixed agent names from persisted subagent runtime state (GH-3259)", async () => {
    //#given - persisted runtime agent metadata from v3.14.0-v3.16.0 with ZWSP prefix
    readProviderModelsCacheMock.mockReturnValue({
      models: {},
      connected: [],
      updatedAt: "2026-03-03T00:00:00.000Z",
    })
    const args = createBaseArgs({ subagent_type: "Hephaestus - Deep Agent" })
    const executorCtx = createExecutorContext(async () => ([
      { name: "\u200B\u200BHephaestus - Deep Agent", mode: "subagent", model: "openai/gpt-5.3-codex" },
    ]))

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "oracle", "deep")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("Hephaestus - Deep Agent")
  })
})
