const { describe, test, expect, beforeEach, afterEach, mock, spyOn } = require("bun:test")

function clearRequireCache(modulePath: string): void {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
}

describe("executeSyncTask - cleanup on error paths", () => {
  let removeTaskCalls: string[] = []
  let addTaskCalls: any[] = []
  let deleteCalls: string[] = []
  let addCalls: string[] = []
  let resetToastManager: (() => void) | null = null

  beforeEach(() => {
    //#given - configure fast timing for all tests
    const { __setTimingConfig } = require("./timing")
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 100,
    })

    //#given - reset call tracking
    removeTaskCalls = []
    addTaskCalls = []
    deleteCalls = []
    addCalls = []

    clearRequireCache("./sync-task")

    //#given - initialize real task toast manager (avoid global module mocks)
    const { initTaskToastManager, _resetTaskToastManagerForTesting } = require("../../features/task-toast-manager/manager")
    _resetTaskToastManagerForTesting()
    resetToastManager = _resetTaskToastManagerForTesting

    const toastManager = initTaskToastManager({
      tui: { showToast: mock(() => Promise.resolve()) },
    })

    spyOn(toastManager, "addTask").mockImplementation((task: any) => {
      addTaskCalls.push(task)
    })
    spyOn(toastManager, "removeTask").mockImplementation((id: string) => {
      removeTaskCalls.push(id)
    })

    //#given - mock subagentSessions
    const { subagentSessions } = require("../../features/claude-code-session-state")
    spyOn(subagentSessions, "add").mockImplementation((id: string) => {
      addCalls.push(id)
    })
    spyOn(subagentSessions, "delete").mockImplementation((id: string) => {
      deleteCalls.push(id)
    })

  })

  afterEach(() => {
    //#given - reset timing after each test
    const { __resetTimingConfig } = require("./timing")
    __resetTimingConfig()

    mock.restore()
    resetToastManager?.()
    resetToastManager = null
  })

  test("cleans up toast and subagentSessions when fetchSyncResult returns ok: false", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: false as const, error: "Fetch failed" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask with fetchSyncResult failing
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)

    //#then - should return error and cleanup resources
    expect(result).toBe("Fetch failed")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })

  test("rolls back reserved descendant quota when sync session creation fails", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const commit = mock(() => 1)
    const rollback = mock(() => {})
    const reserveSubagentSpawn = mock(async () => ({
      spawnContext: { rootSessionID: "parent-session", parentDepth: 0, childDepth: 1 },
      descendantCount: 1,
      commit,
      rollback,
    }))

    const deps = {
      createSyncSession: async () => ({ ok: false as const, error: "Failed to create session" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      manager: { reserveSubagentSpawn },
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)

    //#then
    expect(result).toBe("Failed to create session")
    expect(reserveSubagentSpawn).toHaveBeenCalledWith("parent-session")
    expect(commit).toHaveBeenCalledTimes(0)
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  test("cleans up toast and subagentSessions when pollSyncSession returns error", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => "Poll error",
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask with pollSyncSession failing
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)

    //#then - should return error and cleanup resources
    expect(result).toBe("Poll error")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })

  test("#given fallback chain set #when sendSyncPrompt fails #then retries with next model", async () => {
    //#given
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")
    const attemptedModels: Array<{ providerID: string; modelID: string; variant?: string } | undefined> = []

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async (_client: unknown, input: { categoryModel?: { providerID: string; modelID: string; variant?: string } }) => {
        attemptedModels.push(input.categoryModel)
        return attemptedModels.length === 1 ? "Initial failure" : null
      },
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    const initialModel = {
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
      variant: "max",
    }
    const fallbackChain = [
      { providers: ["anthropic"], model: "claude-opus-4-7", variant: "max" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ]

    //#when
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", initialModel, undefined, undefined, fallbackChain, deps)

    //#then
    expect(result).toContain("Task completed")
    expect(result).toContain("Model: opencode-go/kimi-k2.5")
    expect(attemptedModels).toEqual([
      { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
      { providerID: "opencode-go", modelID: "kimi-k2.5", variant: undefined },
    ])
  })

  test("#given fallback chain exhausted #when all retries fail #then returns final error", async () => {
    //#given
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")
    const attemptedModels: Array<{ providerID: string; modelID: string; variant?: string } | undefined> = []
    const promptErrors = ["Initial failure", "Second failure", "Final failure"]

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async (_client: unknown, input: { categoryModel?: { providerID: string; modelID: string; variant?: string } }) => {
        attemptedModels.push(input.categoryModel)
        return promptErrors[attemptedModels.length - 1] ?? "Unexpected extra retry"
      },
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    const initialModel = {
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
      variant: "max",
    }
    const fallbackChain = [
      { providers: ["anthropic"], model: "claude-opus-4-7", variant: "max" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["openai"], model: "gpt-5.4", variant: "medium" },
    ]

    //#when
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", initialModel, undefined, undefined, fallbackChain, deps)

    //#then
    expect(result).toBe("Final failure")
    expect(attemptedModels).toEqual([
      { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
      { providerID: "opencode-go", modelID: "kimi-k2.5", variant: undefined },
      { providerID: "openai", modelID: "gpt-5.4", variant: "medium" },
    ])
  })

  test("cleans up toast and subagentSessions on successful completion", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const commit = mock(() => 1)
    const rollback = mock(() => {})

    const mockExecutorCtx = {
      manager: {
        reserveSubagentSpawn: mock(async () => ({
          spawnContext: { rootSessionID: "parent-session", parentDepth: 0, childDepth: 1 },
          descendantCount: 1,
          commit,
          rollback,
        })),
      },
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask completes successfully
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)

    //#then - should complete and cleanup resources
    expect(result).toContain("Task completed")
    expect(mockExecutorCtx.manager.reserveSubagentSpawn).toHaveBeenCalledWith("parent-session")
    expect(commit).toHaveBeenCalledTimes(1)
    expect(rollback).toHaveBeenCalledTimes(0)
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })

  test("depth regression: blocks spawn when reserveSubagentSpawn throws depth limit error", async () => {
    // This is a smoke test guarding against regressions where the depth limit
    // would be silently bypassed (e.g. via a fallback path that hardcodes
    // childDepth: 1).

    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const reserveSubagentSpawn = mock(async () => {
      throw new Error(
        "Subagent spawn blocked: child depth 4 exceeds background_task.maxDepth=3. Parent session: parent. Root session: root. Continue in an existing subagent session instead of spawning another."
      )
    })

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      manager: { reserveSubagentSpawn },
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask is called from a session at max depth
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)

    //#then - should propagate the depth limit error and NOT create the session
    expect(result).toContain("Subagent spawn blocked")
    expect(result).toContain("child depth 4")
    expect(result).toContain("maxDepth=3")
    expect(reserveSubagentSpawn).toHaveBeenCalledWith("parent-session")
    // critical: createSyncSession must NOT have been called -- if it was,
    // the depth guard was bypassed.
    expect(addCalls.length).toBe(0)
  })

  test("depth regression: does not silently fall back to childDepth: 1 when manager methods are present", async () => {
    // Guards against the dangerous fallback path in sync-task.ts that
    // hardcodes childDepth: 1 if reserveSubagentSpawn / assertCanSpawn are
    // not functions. With a real manager present, the fallback must NOT be
    // taken.

    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    let reservedDepth: number | undefined
    const commit = mock(() => 1)
    const rollback = mock(() => {})
    const reserveSubagentSpawn = mock(async () => {
      // Return a depth that proves the real manager was consulted
      reservedDepth = 3
      return {
        spawnContext: { rootSessionID: "root", parentDepth: 2, childDepth: 3 },
        descendantCount: 5,
        commit,
        rollback,
      }
    })

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

    const metadataCalls: any[] = []
    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: (input: any) => { metadataCalls.push(input) },
    }

    const mockExecutorCtx = {
      manager: { reserveSubagentSpawn },
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when
    await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)

    //#then - the spawnDepth recorded in metadata MUST match what reserveSubagentSpawn returned
    expect(reservedDepth).toBe(3)
    const taskMeta = metadataCalls.find((c) => c.metadata?.spawnDepth !== undefined)
    expect(taskMeta).toBeDefined()
    expect(taskMeta.metadata.spawnDepth).toBe(3) // NOT 1 (the fallback value)
  })
})

export {}
