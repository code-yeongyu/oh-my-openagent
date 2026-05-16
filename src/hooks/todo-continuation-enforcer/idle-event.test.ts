/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { handleSessionIdle } from "./idle-event"
import type { SessionStateStore } from "./session-state"
import type { ContinuationProgressUpdate, SessionState } from "./types"

function createStateStore(): {
  store: SessionStateStore
  resetCalls: string[]
  trackCalls: string[]
  state: SessionState
} {
  const state: SessionState = {
    stagnationCount: 0,
    consecutiveFailures: 0,
  }
  const resetCalls: string[] = []
  const trackCalls: string[] = []
  const progressUpdate: ContinuationProgressUpdate = {
    previousStagnationCount: 0,
    stagnationCount: 0,
    hasProgressed: false,
    progressSource: "none",
  }

  return {
    resetCalls,
    trackCalls,
    state,
    store: {
      getState: () => state,
      getExistingState: () => state,
      startPruneInterval: () => {},
      trackContinuationProgress: (sessionID: string) => {
        trackCalls.push(sessionID)
        return progressUpdate
      },
      resetContinuationProgress: (sessionID: string) => {
        resetCalls.push(sessionID)
      },
      cancelCountdown: () => {},
      cleanup: () => {},
      cancelAllCountdowns: () => {},
      shutdown: () => {},
    },
  }
}

describe("handleSessionIdle", () => {
  it("resets continuation progress once when todos are empty", async () => {
    // given
    const sessionID = "ses_empty_todos"
    const { store, resetCalls } = createStateStore()
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          todo: async () => ({ data: [] }),
        },
      },
      directory: "/tmp/test",
    }

    // when
    await handleSessionIdle({
      ctx: ctx as never,
      sessionID,
      sessionStateStore: store,
    })

    // then
    expect(resetCalls).toEqual([sessionID])
  })

  it("resets continuation progress once when every todo is complete", async () => {
    // given
    const sessionID = "ses_completed_todos"
    const { store, resetCalls } = createStateStore()
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          todo: async () => ({
            data: [
              { id: "todo-1", content: "Ship", status: "completed", priority: "high" },
              { id: "todo-2", content: "Verify", status: "completed", priority: "medium" },
            ],
          }),
        },
      },
      directory: "/tmp/test",
    }

    // when
    await handleSessionIdle({
      ctx: ctx as never,
      sessionID,
      sessionStateStore: store,
    })

    // then
    expect(resetCalls).toEqual([sessionID])
  })

  it("does not re-enter the injection path on subsequent idle events once all todos are complete (#4013 P0.1)", async () => {
    // given
    const sessionID = "ses_stop_flag"
    const { store, resetCalls, trackCalls, state } = createStateStore()
    const completedTodos = [
      { id: "todo-1", content: "Ship", status: "completed", priority: "high" },
    ]
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          todo: async () => ({ data: completedTodos }),
        },
      },
      directory: "/tmp/test",
    }

    // when — first idle: detects incompleteCount === 0, sets the stop flag
    await handleSessionIdle({ ctx: ctx as never, sessionID, sessionStateStore: store })

    // sanity: stop flag was set and reset was called
    expect(state.allTodosCompletedAt).toBeGreaterThan(0)
    expect(resetCalls).toHaveLength(1)

    // when — second idle: stop flag already set, must bail out immediately
    await handleSessionIdle({ ctx: ctx as never, sessionID, sessionStateStore: store })

    // then: trackContinuationProgress was never called (injection path never reached)
    expect(trackCalls).toHaveLength(0)
    // reset is still called only once (from the first idle)
    expect(resetCalls).toHaveLength(1)
  })
})
