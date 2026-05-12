/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { handleSessionIdle } from "./idle-event"
import type { SessionStateStore } from "./session-state"
import type { ContinuationProgressUpdate, SessionState } from "./types"

function createStateStore(): {
  store: SessionStateStore
  resetCalls: string[]
} {
  const state: SessionState = {
    stagnationCount: 0,
    consecutiveFailures: 0,
  }
  const resetCalls: string[] = []
  const progressUpdate: ContinuationProgressUpdate = {
    previousStagnationCount: 0,
    stagnationCount: 0,
    hasProgressed: false,
    progressSource: "none",
  }

  return {
    resetCalls,
    store: {
      getState: () => state,
      getExistingState: () => state,
      startPruneInterval: () => {},
      recordActivity: () => {},
      trackContinuationProgress: () => progressUpdate,
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
  
  function createStateStoreWithState(initialState: Partial<SessionState>): {
    store: SessionStateStore
    resetCalls: string[]
  } {
    const state: SessionState = {
      stagnationCount: 0,
      consecutiveFailures: 0,
      ...initialState,
    } as SessionState
    const resetCalls: string[] = []
    const progressUpdate: ContinuationProgressUpdate = {
      previousStagnationCount: 0,
      stagnationCount: 0,
      hasProgressed: false,
      progressSource: "none",
    }

    return {
      resetCalls,
      store: {
        getState: () => state,
        getExistingState: () => state,
        startPruneInterval: () => {},
        recordActivity: () => {},
        trackContinuationProgress: () => progressUpdate,
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

  describe("continuationConfig", () => {
    it("proceeds past abort check when custom abortWindowMs is smaller than elapsed", async () => {
      // given
      const sessionID = "ses_custom_abort_small"
      const abortDetectedAt = Date.now() - 2000
      const { store, resetCalls } = createStateStoreWithState({ abortDetectedAt })
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
        continuationConfig: { abortWindowMs: 500 },
      })

      // then
      expect(resetCalls).toEqual([sessionID])
    })

    it("returns early when custom abortWindowMs is larger than elapsed", async () => {
      // given
      const sessionID = "ses_custom_abort_large"
      const abortDetectedAt = Date.now() - 4000
      const { store, resetCalls } = createStateStoreWithState({ abortDetectedAt })
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
        continuationConfig: { abortWindowMs: 10000 },
      })

      // then
      expect(resetCalls).toEqual([])
    })

    it("returns early when consecutiveFailures is at custom maxConsecutiveFailures", async () => {
      // given
      const sessionID = "ses_failure_limit"
      const { store, resetCalls } = createStateStoreWithState({ consecutiveFailures: 3 })
      const ctx = {
        client: {
          session: {
            messages: async () => ({ data: [] }),
            todo: async () => ({
              data: [{ id: "todo-1", content: "Do something", status: "in_progress", priority: "high" }],
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
        continuationConfig: { maxConsecutiveFailures: 3 },
      })

      // then
      expect(resetCalls).toEqual([])
    })
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
})
