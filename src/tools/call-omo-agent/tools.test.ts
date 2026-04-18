const { beforeEach, describe, test, expect, mock } = require("bun:test")
const { createCallOmoAgent } = require("./tools")
const { clearCallableAgentsCache } = require("./agent-resolver")

type PluginInput = { client: any; directory: string }
type BackgroundManager = {
  assertCanSpawn: Function
  reserveSubagentSpawn: Function
  launch: Function
  getTask: Function
}

function createMockCtx(agents: Array<{ name: string; mode?: string }> = []): PluginInput {
  return {
    client: {
      app: {
        agents: mock(() => Promise.resolve({ data: agents })),
      },
    },
    directory: "/test",
  } as unknown as PluginInput
}

function createFailingMockCtx(error: Error = new Error("API unavailable")): PluginInput {
  return {
    client: {
      app: {
        agents: mock(() => Promise.reject(error)),
      },
    },
    directory: "/test",
  } as unknown as PluginInput
}

const DEFAULT_AGENTS = [
  { name: "explore", mode: "subagent" },
  { name: "librarian", mode: "subagent" },
  { name: "oracle", mode: "subagent" },
  { name: "hephaestus", mode: "subagent" },
  { name: "metis", mode: "subagent" },
  { name: "momus", mode: "subagent" },
  { name: "multimodal-looker", mode: "subagent" },
]

const assertCanSpawnMock = mock(() => Promise.resolve(undefined))
const reserveCommitMock = mock(() => 1)
const reserveRollbackMock = mock(() => {})
const reserveSubagentSpawnMock = mock(() => Promise.resolve({
  spawnContext: { rootSessionID: "root-session", parentDepth: 0, childDepth: 1 },
  descendantCount: 1,
  commit: reserveCommitMock,
  rollback: reserveRollbackMock,
}))

const mockBackgroundManager = {
  assertCanSpawn: assertCanSpawnMock,
  reserveSubagentSpawn: reserveSubagentSpawnMock,
  launch: mock(() => Promise.resolve({
    id: "test-task-id",
    sessionID: null,
    description: "Test task",
    agent: "test-agent",
    status: "pending",
  })),
  getTask: mock(() => ({ status: "pending", sessionID: "ses-123" })),
} as unknown as BackgroundManager

const toolCtx = {
  sessionID: "test",
  messageID: "msg",
  agent: "test",
  abort: new AbortController().signal,
}

beforeEach(() => {
  clearCallableAgentsCache()
  assertCanSpawnMock.mockClear()
  reserveSubagentSpawnMock.mockClear()
  reserveCommitMock.mockClear()
  reserveRollbackMock.mockClear()
})

describe("createCallOmoAgent", () => {
  describe("disabled_agents validation", () => {
    test("should reject agent in disabled_agents list", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["explore"])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Test prompt", subagent_type: "explore", run_in_background: true },
        toolCtx
      )

      expect(result).toContain("disabled via disabled_agents")
    })

    test("should reject agent in disabled_agents list with case-insensitive matching", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["Explore"])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Test prompt", subagent_type: "explore", run_in_background: true },
        toolCtx
      )

      expect(result).toContain("disabled via disabled_agents")
    })

    test("should allow agent not in disabled_agents list", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["librarian"])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Test prompt", subagent_type: "explore", run_in_background: true },
        toolCtx
      )

      expect(result).not.toContain("disabled via disabled_agents")
    })

    test("should allow all agents when disabled_agents is empty", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Test prompt", subagent_type: "explore", run_in_background: true },
        toolCtx
      )

      expect(result).not.toContain("disabled via disabled_agents")
    })
  })

  describe("dynamic custom agent resolution", () => {
    test("should accept a custom agent returned by client.app.agents()", async () => {
      const agents = [...DEFAULT_AGENTS, { name: "bug-fixer", mode: "subagent" }]
      const mockCtx = createMockCtx(agents)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Fix bug", subagent_type: "bug-fixer", run_in_background: true },
        toolCtx
      )

      expect(result).not.toContain("Invalid agent type")
      expect(result).not.toContain("not found")
    })

    test("should reject a custom agent NOT returned by client.app.agents()", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Fix bug", subagent_type: "nonexistent-agent", run_in_background: true },
        toolCtx
      )

      expect(result).toContain("Invalid agent type")
    })

    test("should perform case-insensitive matching for custom agents", async () => {
      const agents = [...DEFAULT_AGENTS, { name: "Bug-Fixer", mode: "subagent" }]
      const mockCtx = createMockCtx(agents)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Fix bug", subagent_type: "bug-fixer", run_in_background: true },
        toolCtx
      )

      expect(result).not.toContain("Invalid agent type")
    })

    test("should exclude primary-mode agents from callable list", async () => {
      const agents = [
        ...DEFAULT_AGENTS,
        { name: "sisyphus", mode: "primary" },
      ]
      const mockCtx = createMockCtx(agents)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Orchestrate", subagent_type: "sisyphus", run_in_background: true },
        toolCtx
      )

      expect(result).toContain("Invalid agent type")
    })

    test("should fall back to ALLOWED_AGENTS when client.app.agents() fails", async () => {
      const mockCtx = createFailingMockCtx()
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Explore codebase", subagent_type: "explore", run_in_background: true },
        toolCtx
      )

      expect(result).not.toContain("Invalid agent type")
    })

    test("should reject unknown agent even when client.app.agents() fails (fallback mode)", async () => {
      const mockCtx = createFailingMockCtx()
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Fix bug", subagent_type: "custom-agent", run_in_background: true },
        toolCtx
      )

      expect(result).toContain("Invalid agent type")
    })

    test("should still apply disabled_agents check to dynamically resolved custom agents", async () => {
      const agents = [...DEFAULT_AGENTS, { name: "bug-fixer", mode: "subagent" }]
      const mockCtx = createMockCtx(agents)
      const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["bug-fixer"])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        { description: "Test", prompt: "Fix bug", subagent_type: "bug-fixer", run_in_background: true },
        toolCtx
      )

      expect(result).toContain("disabled via disabled_agents")
    })
  })

  test("uses agent override fallback_models when launching background subagent", async () => {
    //#given
    const launch = mock((_input: { fallbackChain?: Array<{ providers: string[]; model: string; variant?: string }> }) => Promise.resolve({
      id: "task-fallback",
      sessionID: "sub-session",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
    const managerWithLaunch = {
      launch,
      getTask: mock(() => undefined),
    }
    const mockCtx = createMockCtx(DEFAULT_AGENTS)
    const toolDef = createCallOmoAgent(
      mockCtx,
      managerWithLaunch,
      [],
      {
        explore: {
          fallback_models: ["quotio/kimi-k2.5", "openai/gpt-5.2(high)"],
        },
      },
    )
    const executeFunc = toolDef.execute as Function

    //#when
    await executeFunc(
      {
        description: "Test fallback",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    const firstLaunchCall = launch.mock.calls[0]
    if (firstLaunchCall === undefined) {
      throw new Error("Expected launch to be called")
    }

    const [launchArgs] = firstLaunchCall
    expect(launchArgs.fallbackChain).toEqual([
      { providers: ["quotio"], model: "kimi-k2.5", variant: undefined },
      { providers: ["openai"], model: "gpt-5.2", variant: "high" },
    ])
  })

  test("forwards model override from agent config to background executor (#2852)", async () => {
    //#given
    const launch = mock((_input: { model?: { providerID: string; modelID: string }; fallbackChain?: unknown[] }) => Promise.resolve({
      id: "task-model",
      sessionID: "sub-session",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
    const managerWithLaunch = {
      launch,
      getTask: mock(() => undefined),
    }
    const toolDef = createCallOmoAgent(
      createMockCtx(DEFAULT_AGENTS),
      managerWithLaunch,
      [],
      {
        explore: {
          model: "aws/anthropic/claude-sonnet-4",
        },
      },
    )
    const executeFunc = toolDef.execute as Function

    //#when
    await executeFunc(
      {
        description: "Test model override",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    const firstLaunchCall = launch.mock.calls[0]
    if (firstLaunchCall === undefined) {
      throw new Error("Expected launch to be called")
    }

    const [launchArgs] = firstLaunchCall
    expect(launchArgs.model).toEqual({
      providerID: "aws",
      modelID: "anthropic/claude-sonnet-4",
    })
  })

  test("forwards model variant from agent config to background executor (#2852)", async () => {
    //#given
    const launch = mock((_input: { model?: { providerID: string; modelID: string; variant?: string } }) => Promise.resolve({
      id: "task-variant",
      sessionID: "sub-session",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
    const managerWithLaunch = {
      launch,
      getTask: mock(() => undefined),
    }
    const toolDef = createCallOmoAgent(
      createMockCtx(DEFAULT_AGENTS),
      managerWithLaunch,
      [],
      {
        explore: {
          model: "openai/gpt-5.4",
          variant: "high",
        },
      },
    )
    const executeFunc = toolDef.execute as Function

    //#when
    await executeFunc(
      {
        description: "Test variant",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    const firstLaunchCall = launch.mock.calls[0]
    if (firstLaunchCall === undefined) {
      throw new Error("Expected launch to be called")
    }

    const [launchArgs] = firstLaunchCall
    expect(launchArgs.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "high",
    })
  })

  test("parses inline model variant from agent config override", async () => {
    //#given
    const launch = mock((_input: { model?: { providerID: string; modelID: string; variant?: string } }) => Promise.resolve({
      id: "task-inline-variant",
      sessionID: "sub-session",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
    const managerWithLaunch = {
      launch,
      getTask: mock(() => undefined),
    }
    const toolDef = createCallOmoAgent(
      createMockCtx(DEFAULT_AGENTS),
      managerWithLaunch,
      [],
      {
        explore: {
          model: "openai/gpt-5.4 high",
        },
      },
    )
    const executeFunc = toolDef.execute as Function

    //#when
    await executeFunc(
      {
        description: "Test inline variant",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    const firstLaunchCall = launch.mock.calls[0]
    if (firstLaunchCall === undefined) {
      throw new Error("Expected launch to be called")
    }

    const [launchArgs] = firstLaunchCall
    expect(launchArgs.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "high",
    })
  })

  test("forwards category-derived model override to background executor", async () => {
    //#given
    const launch = mock((_input: { model?: { providerID: string; modelID: string } }) => Promise.resolve({
      id: "task-category-model",
      sessionID: "sub-session",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
    const managerWithLaunch = {
      launch,
      getTask: mock(() => undefined),
    }
    const toolDef = createCallOmoAgent(
      createMockCtx(DEFAULT_AGENTS),
      managerWithLaunch,
      [],
      {
        explore: {
          category: "research",
        },
      },
      {
        research: {
          model: "openai/gpt-5.4",
        },
      },
    )
    const executeFunc = toolDef.execute as Function

    //#when
    await executeFunc(
      {
        description: "Test category model override",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    const firstLaunchCall = launch.mock.calls[0]
    if (firstLaunchCall === undefined) {
      throw new Error("Expected launch to be called")
    }

    const [launchArgs] = firstLaunchCall
    expect(launchArgs.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
  })

  test("should return a tool error when sync spawn depth validation fails", async () => {
    //#given
    const mockCtx = createMockCtx(DEFAULT_AGENTS)
    reserveSubagentSpawnMock.mockRejectedValueOnce(new Error("Subagent spawn blocked: child depth 4 exceeds background_task.maxDepth=3."))
    const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
    const executeFunc = toolDef.execute as Function

    //#when
    const result = await executeFunc(
      {
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: false,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal },
    )

    //#then
    expect(result).toContain("background_task.maxDepth=3")
  })
})

export {}
