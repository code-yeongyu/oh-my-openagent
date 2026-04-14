import { describe, expect, test } from "bun:test"
import { createLoopStateController } from "./loop-state-controller"
import { continueIteration } from "./iteration-continuation"
import type { RalphLoopState } from "./types"

describe("ralph-loop default reset strategy", () => {
  test("#given no strategy is configured #when loop starts #then state defaults to reset", () => {
    const loopState = createLoopStateController({
      directory: process.cwd(),
      stateDir: ".tmp-ralph-loop-default-reset-test",
      config: undefined,
    })

    const started = loopState.startLoop("session-123", "Ship fix")

    expect(started).toBe(true)
    expect(loopState.getState()?.strategy).toBe("reset")
    loopState.clear()
  })

  test("#given legacy state without strategy #when loop continues #then it creates a fresh session", async () => {
    const createCalls: Array<{ parentID?: string; directory?: string }> = []
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const selectCalls: string[] = []
    let currentSessionID = "session-123"

    const state: RalphLoopState = {
      active: true,
      iteration: 2,
      max_iterations: 100,
      completion_promise: "DONE",
      started_at: new Date().toISOString(),
      prompt: "Ship fix",
      session_id: currentSessionID,
    }

    await continueIteration(
      {
        directory: process.cwd(),
        client: {
          session: {
            create: async (options: { body: { parentID?: string }; query?: { directory?: string } }) => {
              createCalls.push({
                parentID: options.body.parentID,
                directory: options.query?.directory,
              })

              return { data: { id: "session-456" } }
            },
            promptAsync: async (options: { path: { id: string }; body: { parts: Array<{ text: string }> } }) => {
              promptCalls.push({
                sessionID: options.path.id,
                text: options.body.parts[0]?.text ?? "",
              })

              return {}
            },
          },
          tui: {
            selectSession: async (options: { body: { sessionID: string } }) => {
              selectCalls.push(options.body.sessionID)
              return {}
            },
          },
        },
      } as Parameters<typeof continueIteration>[0],
      state,
      {
        directory: process.cwd(),
        apiTimeoutMs: 100,
        previousSessionID: "session-123",
        loopState: {
          setSessionID: (sessionID: string) => {
            currentSessionID = sessionID
            return { ...state, session_id: sessionID }
          },
        },
      },
    )

    expect(createCalls).toEqual([{ parentID: "session-123", directory: process.cwd() }])
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.sessionID).toBe("session-456")
    expect(selectCalls).toEqual(["session-456"])
    expect(currentSessionID).toBe("session-456")
  })
})
