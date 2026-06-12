/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createTodoContinuationHandler } from "./handler"
import type { ContinuationProgressUpdate, SessionStateStore } from "./session-state"
import type { SessionState } from "./types"

function createRecordingStateStore(): {
  readonly cancelCalls: string[]
  readonly state: SessionState
  readonly store: SessionStateStore
} {
  const state: SessionState = {
    stagnationCount: 2,
    consecutiveFailures: 1,
    countdownStartedAt: Date.now(),
    countdownTimer: 1 as never,
  }
  const cancelCalls: string[] = []
  const progressUpdate: ContinuationProgressUpdate = {
    previousStagnationCount: 0,
    stagnationCount: 0,
    hasProgressed: false,
    progressSource: "none",
  }

  return {
    cancelCalls,
    state,
    store: {
      getState: () => state,
      getExistingState: () => state,
      startPruneInterval: () => {},
      trackContinuationProgress: () => progressUpdate,
      resetContinuationProgress: () => {},
      cancelCountdown: (sessionID: string) => {
        cancelCalls.push(sessionID)
      },
      cleanup: () => {},
      cancelAllCountdowns: () => {},
      shutdown: () => {},
    },
  }
}

describe("createTodoContinuationHandler", () => {
  test("#given an active continuation countdown #when the session compacts #then it arms the compaction guard without cancelling the countdown", async () => {
    // given
    const sessionID = "ses_compaction_keeps_countdown"
    const { cancelCalls, state, store } = createRecordingStateStore()
    const handler = createTodoContinuationHandler({
      ctx: {} as never,
      sessionStateStore: store,
    })

    // when
    await handler({ event: { type: "session.compacted", properties: { sessionID } } })

    // then
    expect(cancelCalls).toEqual([])
    expect(state.recentCompactionEpoch).toBe(1)
    expect(typeof state.recentCompactionAt).toBe("number")
    expect(state.countdownStartedAt).toBeDefined()
  })

  test("#given an active continuation countdown #when an abort session error arrives #then it still cancels the countdown", async () => {
    // given
    const sessionID = "ses_abort_cancels_countdown"
    const { cancelCalls, state, store } = createRecordingStateStore()
    const handler = createTodoContinuationHandler({
      ctx: {} as never,
      sessionStateStore: store,
    })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // then
    expect(cancelCalls).toEqual([sessionID])
    expect(state.wasCancelled).toBe(true)
    expect(state.stagnationCount).toBe(0)
    expect(state.consecutiveFailures).toBe(0)
  })
})
