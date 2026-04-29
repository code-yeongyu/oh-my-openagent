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
