const { beforeEach, describe, test, expect, mock } = require("bun:test")
const { createCallOmoAgent } = require("./tools")

describe("createCallOmoAgent", () => {
  const assertCanSpawnMock = mock(() => Promise.resolve(undefined))
  const reserveCommitMock = mock(() => 1)
  const reserveRollbackMock = mock(() => {})
  const reserveSubagentSpawnMock = mock(() => Promise.resolve({
    spawnContext: { rootSessionID: "root-session", parentDepth: 0, childDepth: 1 },
    descendantCount: 1,
    commit: reserveCommitMock,
    rollback: reserveRollbackMock,
  }))
  const mockCtx = {
    client: {},
    directory: "/test",
  }

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
  }

  beforeEach(() => {
    assertCanSpawnMock.mockClear()
    reserveSubagentSpawnMock.mockClear()
    reserveCommitMock.mockClear()
    reserveRollbackMock.mockClear()
  })

  test("should reject agent in disabled_agents list", async () => {
    //#given
    const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["explore"])
    const executeFunc = toolDef.execute as Function

    //#when
    const result = await executeFunc(
      {
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    expect(result).toContain("disabled via disabled_agents")
  })

  test("should reject agent in disabled_agents list with case-insensitive matching", async () => {
    //#given
    const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["Explore"])
    const executeFunc = toolDef.execute as Function

    //#when
    const result = await executeFunc(
      {
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    expect(result).toContain("disabled via disabled_agents")
  })

  test("should allow agent not in disabled_agents list", async () => {
    //#given
    const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, ["librarian"])
    const executeFunc = toolDef.execute as Function

    //#when
    const result = await executeFunc(
      {
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    // Should not contain disabled error - may fail for other reasons but disabled check should pass
    expect(result).not.toContain("disabled via disabled_agents")
  })

  test("should allow all agents when disabled_agents is empty", async () => {
    //#given
    const toolDef = createCallOmoAgent(mockCtx, mockBackgroundManager, [])
    const executeFunc = toolDef.execute as Function

    //#when
    const result = await executeFunc(
      {
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "explore",
        run_in_background: true,
      },
      { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal }
    )

    //#then
    expect(result).not.toContain("disabled via disabled_agents")
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

  test("should return a tool error when sync spawn depth validation fails", async () => {
    //#given
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
