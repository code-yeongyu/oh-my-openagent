/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FallbackCycleRegistry } from "../shared/fallback-cycle-registry"
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
      cancelCountdown: () => {
        if (state.countdownTimer) {
          clearTimeout(state.countdownTimer)
          state.countdownTimer = undefined
        }
        if (state.countdownInterval) {
          clearInterval(state.countdownInterval)
          state.countdownInterval = undefined
        }
        state.countdownStartedAt = undefined
        state.inFlight = false
      },
      cleanup: () => {},
      cancelAllCountdowns: () => {},
      shutdown: () => {},
    },
  }
}

function createIdleCtxWithIncompleteTodo() {
  return {
    client: {
      session: {
        messages: async () => ({ data: [] }),
        todo: async () => ({
          data: [
            { id: "todo-1", content: "Ship the fix", status: "pending", priority: "high" },
          ],
        }),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/tmp/test",
  }
}

describe("handleSessionIdle fallback-cycle suppression (#2063)", () => {
  it("#given incomplete todos and an active runtime-fallback retry cycle #when session.idle fires #then continuation is suppressed", async () => {
    // given
    const sessionID = "ses_2063_fallback_active"
    const { store, trackCalls, state } = createStateStore()
    const probe = (id: string) => id === sessionID
    FallbackCycleRegistry.register(probe)

    try {
      // when
      await handleSessionIdle({
        ctx: createIdleCtxWithIncompleteTodo() as never,
        sessionID,
        sessionStateStore: store,
      })

      // then
      expect(trackCalls).toEqual([])
      expect(state.countdownStartedAt).toBeUndefined()
    } finally {
      FallbackCycleRegistry.unregister(probe)
      store.cancelCountdown(sessionID)
    }
  })

  it("#given the runtime-fallback cycle has cleared #when session.idle fires #then continuation proceeds normally", async () => {
    // given
    const sessionID = "ses_2063_fallback_cleared"
    const { store, trackCalls } = createStateStore()

    try {
      // when
      await handleSessionIdle({
        ctx: createIdleCtxWithIncompleteTodo() as never,
        sessionID,
        sessionStateStore: store,
      })

      // then
      expect(trackCalls).toEqual([sessionID])
    } finally {
      store.cancelCountdown(sessionID)
    }
  })
})
