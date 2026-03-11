import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  _resetForTesting,
  subagentSessions,
  syncSubagentSessions,
} from "../../features/claude-code-session-state"
import { executeSync } from "./sync-executor"

type ExecuteSyncArgs = Parameters<typeof executeSync>[0]
type ExecuteSyncToolContext = Parameters<typeof executeSync>[1]
type ExecuteSyncDeps = NonNullable<Parameters<typeof executeSync>[3]>

function createArgs(): ExecuteSyncArgs {
  return {
    subagent_type: "explore",
    description: "cleanup leak",
    prompt: "find something",
    run_in_background: false,
  }
}

function createToolContext(): ExecuteSyncToolContext {
  return {
    sessionID: "parent-session",
    messageID: "msg-1",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: mock(async () => {}),
  }
}

function createContext(promptAsync: ReturnType<typeof mock>) {
  return {
    client: {
      session: {
        promptAsync,
      },
    },
  }
}

function createDependencies(overrides?: Partial<ExecuteSyncDeps>): ExecuteSyncDeps {
  return {
    createOrGetSession: mock(async () => ({ sessionID: "ses-default", isNew: true })),
    waitForCompletion: mock(async () => {}),
    processMessages: mock(async () => "agent response"),
    setSessionFallbackChain: mock(() => {}),
    ...overrides,
  }
}

describe("executeSync session cleanup", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  describe("#given executeSync creates a session", () => {
    test("#when execution completes successfully #then sessionID is removed from subagentSessions and syncSubagentSessions", async () => {
      // given
      const sessionID = "ses-cleanup-success"
      const args = createArgs()
      const toolContext = createToolContext()
      const promptAsync = mock(async () => ({ data: {} }))
      const deps = createDependencies({
        createOrGetSession: mock(async () => {
          subagentSessions.add(sessionID)
          syncSubagentSessions.add(sessionID)
          return { sessionID, isNew: true }
        }),
        waitForCompletion: mock(async (createdSessionID: string) => {
          expect(createdSessionID).toBe(sessionID)
          expect(subagentSessions.has(sessionID)).toBe(true)
          expect(syncSubagentSessions.has(sessionID)).toBe(true)
        }),
      })

      expect(subagentSessions.has(sessionID)).toBe(false)
      expect(syncSubagentSessions.has(sessionID)).toBe(false)

      // when
      const result = await executeSync(args, toolContext, createContext(promptAsync) as never, deps)

      // then
      expect(result).toContain(`session_id: ${sessionID}`)
      expect(subagentSessions.has(sessionID)).toBe(false)
      expect(syncSubagentSessions.has(sessionID)).toBe(false)
    })

    test("#when execution throws an error #then sessionID is still removed from both Sets", async () => {
      // given
      const sessionID = "ses-cleanup-error"
      const args = createArgs()
      const toolContext = createToolContext()
      const promptAsync = mock(async () => ({ data: {} }))
      const deps = createDependencies({
        createOrGetSession: mock(async () => {
          subagentSessions.add(sessionID)
          syncSubagentSessions.add(sessionID)
          return { sessionID, isNew: true }
        }),
        waitForCompletion: mock(async (createdSessionID: string) => {
          expect(createdSessionID).toBe(sessionID)
          expect(subagentSessions.has(sessionID)).toBe(true)
          expect(syncSubagentSessions.has(sessionID)).toBe(true)
          throw new Error("poll exploded")
        }),
      })

      // when
      const resultPromise = executeSync(args, toolContext, createContext(promptAsync) as never, deps)

      // then
      let thrownError: Error | undefined

      try {
        await resultPromise
      } catch (error) {
        if (error instanceof Error) {
          thrownError = error
        } else {
          throw error
        }
      }

      expect(thrownError?.message).toBe("poll exploded")
      expect(subagentSessions.has(sessionID)).toBe(false)
      expect(syncSubagentSessions.has(sessionID)).toBe(false)
    })
  })
})
