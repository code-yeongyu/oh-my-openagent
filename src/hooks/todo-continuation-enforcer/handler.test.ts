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

function createCompletedTodoHandler() {
  const { store } = createRecordingStateStore()
  const resetCalls: string[] = []
  let pruneCalls = 0
  let todoCalls = 0
  const handler = createTodoContinuationHandler({
    ctx: {
      directory: "/tmp/test",
      client: {
        session: {
          messages: async () => ({
            data: [
              { info: { id: "msg-user", role: "user" } },
              { info: { id: "msg-assistant", role: "assistant", finish: "stop" } },
            ],
          }),
          todo: async () => {
            todoCalls += 1
            return { data: [{ id: "todo-1", content: "Verify", status: "completed", priority: "high" }] }
          },
        },
      },
    } as never,
    sessionStateStore: {
      ...store,
      startPruneInterval: () => {
        pruneCalls += 1
      },
      resetContinuationProgress: (sessionID: string) => {
        resetCalls.push(sessionID)
      },
    },
  })

  return {
    handler,
    getStats: () => ({ pruneCalls, resetCalls, todoCalls }),
  }
}

describe("createTodoContinuationHandler", () => {
  test("#given assistant response completion with camelCase session id #when message update arrives #then continuation state is checked after response", async () => {
    // given
    const sessionID = "ses_assistant_finish_checks_todos"
    const { handler, getStats } = createCompletedTodoHandler()

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: { info: { id: "msg-assistant", sessionId: sessionID, role: "assistant", finish: "stop" } },
      },
    })

    // then
    expect(getStats()).toEqual({ pruneCalls: 1, resetCalls: [sessionID], todoCalls: 1 })
  })

  test("#given duplicate assistant completion update #when message id repeats #then continuation state is checked once", async () => {
    // given
    const sessionID = "ses_assistant_finish_dedupe"
    const { handler, getStats } = createCompletedTodoHandler()
    const event = {
      type: "message.updated",
      properties: { info: { id: "msg-assistant", sessionID, role: "assistant", finish: "stop" } },
    }

    // when
    await handler({ event })
    await handler({ event })

    // then
    expect(getStats()).toEqual({ pruneCalls: 1, resetCalls: [sessionID], todoCalls: 1 })
  })

  test("#given assistant response is not terminal #when message update arrives #then todo continuation is not checked yet", async () => {
    // given
    const sessionID = "ses_assistant_not_terminal"
    const { handler, getStats } = createCompletedTodoHandler()

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: { info: { id: "msg-assistant-streaming", sessionID, role: "assistant" } },
      },
    })
    await handler({
      event: {
        type: "message.updated",
        properties: { info: { id: "msg-assistant-tool-calls", sessionID, role: "assistant", finish: "tool-calls" } },
      },
    })

    // then
    expect(getStats()).toEqual({ pruneCalls: 0, resetCalls: [], todoCalls: 0 })
  })

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
