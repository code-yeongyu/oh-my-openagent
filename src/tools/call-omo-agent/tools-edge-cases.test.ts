/**
 * Requirement-based integration tests for createCallOmoAgent edge cases
 * around restricted agent validation and execution cleanup.
 *
 * R1: Spawn reservation is rolled back when execution fails after reservation
 * R2: Dynamic runtime agents do not expand the call_omo_agent allowlist
 * R3: An agent present in both ALLOWED_AGENTS and runtime results is callable
 * R4: session_id continuation rejects in background mode when session already exists
 */
const { describe, test, expect, mock, beforeEach } = require("bun:test")
const { createCallOmoAgent } = require("./tools")
const { clearCallableAgentsCache } = require("./agent-resolver")

type PluginInput = { client: any; directory: string }

function createMockCtx(agents: Array<{ name: string; mode?: string }> = []): PluginInput {
  return {
    client: {
      app: {
        agents: mock(() => Promise.resolve({ data: agents })),
      },
    },
    directory: "/test",
    }
}

const DEFAULT_AGENTS = [
  { name: "explore", mode: "subagent" },
  { name: "librarian", mode: "subagent" },
]

const reserveCommitMock = mock(() => 1)
const reserveRollbackMock = mock(() => {})
const reserveSubagentSpawnMock = mock(() => Promise.resolve({
  spawnContext: { rootSessionID: "root-session", parentDepth: 0, childDepth: 1 },
  descendantCount: 1,
  commit: reserveCommitMock,
  rollback: reserveRollbackMock,
}))

const toolCtx = {
  sessionID: "test",
  messageID: "msg",
  agent: "test",
  abort: new AbortController().signal,
}

beforeEach(() => {
  clearCallableAgentsCache()
  reserveSubagentSpawnMock.mockClear()
  reserveCommitMock.mockClear()
  reserveRollbackMock.mockClear()
})

describe("createCallOmoAgent edge cases", () => {
  describe("#given spawn reservation succeeds but sync execution fails", () => {
    test("#then rollback is called to release the reservation", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      reserveSubagentSpawnMock.mockResolvedValueOnce({
        spawnContext: { rootSessionID: "root-session", parentDepth: 0, childDepth: 1 },
        descendantCount: 1,
        commit: reserveCommitMock,
        rollback: reserveRollbackMock,
      })
      const mockManager = {
        assertCanSpawn: mock(() => Promise.resolve(undefined)),
        reserveSubagentSpawn: reserveSubagentSpawnMock,
        launch: mock(() => Promise.resolve()),
        getTask: mock(() => undefined),
      }
      const toolDef = createCallOmoAgent(mockCtx, mockManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        {
          description: "Test",
          prompt: "Test prompt",
          subagent_type: "explore",
          run_in_background: false,
        },
        toolCtx,
      )

      expect(reserveRollbackMock).toHaveBeenCalled()
      expect(result).toContain("Error:")
    })
  })

  describe("#given a non-allowed agent appears in runtime agent results", () => {
    test("#then the runtime agent is still rejected", async () => {
      const agents = [
        ...DEFAULT_AGENTS,
        { name: "  bug-fixer  ", mode: "subagent" },
      ]
      const mockCtx = createMockCtx(agents)
      const mockManager = {
        assertCanSpawn: mock(() => Promise.resolve(undefined)),
        reserveSubagentSpawn: reserveSubagentSpawnMock,
        launch: mock(() => Promise.resolve({
          id: "task-id",
          sessionId: "ses-1",
          description: "Test",
          agent: "bug-fixer",
          status: "pending",
        })),
        getTask: mock(() => ({ status: "pending", sessionId: "ses-1" })),
      }
      const toolDef = createCallOmoAgent(mockCtx, mockManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        {
          description: "Test",
          prompt: "Fix bug",
          subagent_type: "bug-fixer",
          run_in_background: true,
        },
        toolCtx,
      )

      expect(result).toContain("Invalid agent type")
      expect(result).toContain("Only explore, librarian are allowed")
    })
  })

  describe("#given an agent exists in both ALLOWED_AGENTS and runtime results", () => {
    test("#then the agent is callable without conflict", async () => {
      const agents = [
        ...DEFAULT_AGENTS,
        { name: "explore", mode: "subagent" },
      ]
      const mockCtx = createMockCtx(agents)
      const mockManager = {
        assertCanSpawn: mock(() => Promise.resolve(undefined)),
        reserveSubagentSpawn: reserveSubagentSpawnMock,
        launch: mock(() => Promise.resolve({
          id: "task-id",
          sessionId: "ses-1",
          description: "Test",
          agent: "explore",
          status: "pending",
        })),
        getTask: mock(() => ({ status: "pending", sessionId: "ses-1" })),
      }
      const toolDef = createCallOmoAgent(mockCtx, mockManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        {
          description: "Test",
          prompt: "Search codebase",
          subagent_type: "explore",
          run_in_background: true,
        },
        toolCtx,
      )

      expect(result).not.toContain("Invalid agent type")
    })
  })

  describe("#given a disabled custom agent appears in runtime results", () => {
    test("#then restricted agent validation takes precedence over dynamic availability", async () => {
      const agents = [
        ...DEFAULT_AGENTS,
        { name: "bug-fixer", mode: "subagent" },
      ]
      const mockCtx = createMockCtx(agents)
      const mockManager = {
        assertCanSpawn: mock(() => Promise.resolve(undefined)),
        reserveSubagentSpawn: reserveSubagentSpawnMock,
        launch: mock(() => Promise.resolve()),
        getTask: mock(() => undefined),
      }
      const toolDef = createCallOmoAgent(mockCtx, mockManager, ["Bug-Fixer"])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        {
          description: "Test",
          prompt: "Fix bug",
          subagent_type: "bug-fixer",
          run_in_background: true,
        },
        toolCtx,
      )

      expect(result).toContain("Invalid agent type")
      expect(result).not.toContain("disabled via disabled_agents")
    })
  })

  describe("#given session_id is provided in background mode", () => {
    test("#then the request is rejected with a clear error", async () => {
      const mockCtx = createMockCtx(DEFAULT_AGENTS)
      const mockManager = {
        assertCanSpawn: mock(() => Promise.resolve(undefined)),
        reserveSubagentSpawn: reserveSubagentSpawnMock,
        launch: mock(() => Promise.resolve()),
        getTask: mock(() => undefined),
      }
      const toolDef = createCallOmoAgent(mockCtx, mockManager, [])
      const executeFunc = toolDef.execute as Function

      const result = await executeFunc(
        {
          description: "Test",
          prompt: "Continue work",
          subagent_type: "explore",
          run_in_background: true,
          session_id: "ses-existing-123",
        },
        toolCtx,
      )

      expect(result).toContain("session_id is not supported in background mode")
    })
  })
})

export {}
