import { describe, test, expect, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { FallbackEntry } from "../../shared/model-requirements"
import { createCallOmoAgent } from "./tools"

describe("createCallOmoAgent", () => {
  const assertCanSpawnMock = mock(() => Promise.resolve(undefined))
  const mockCtx = {
    client: {},
    directory: "/test",
  } as unknown as PluginInput

  const mockBackgroundManager = {
    assertCanSpawn: assertCanSpawnMock,
    launch: mock(() => Promise.resolve({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "pending",
    })),
  } as unknown as BackgroundManager

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
    const launch = mock((_input: { fallbackChain?: FallbackEntry[] }) => Promise.resolve({
      id: "task-fallback",
      sessionID: "sub-session",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
    const managerWithLaunch = {
      launch,
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
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
    assertCanSpawnMock.mockRejectedValueOnce(new Error("Subagent spawn blocked: child depth 4 exceeds background_task.maxDepth=3."))
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
