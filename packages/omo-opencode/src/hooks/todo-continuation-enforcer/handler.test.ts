/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createTodoContinuationHandler } from "./handler"
import { MAX_CONSECUTIVE_FAILURES } from "./constants"
import { createSessionStateStore, type ContinuationProgressUpdate, type SessionStateStore } from "./session-state"
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

  test("#given a compaction request rejected as non-retryable #when the session error arrives #then it marks the session unrecoverable and cancels the countdown", async () => {
    // given
    const sessionID = "ses_compaction_tool_pair_400"
    const { cancelCalls, state, store } = createRecordingStateStore()
    const handler = createTodoContinuationHandler({
      ctx: {} as never,
      sessionStateStore: store,
    })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: {
            name: "APIError",
            data: {
              message:
                "messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01PCXjcagoMAca32awicQHce.",
              statusCode: 400,
              isRetryable: false,
            },
          },
        },
      },
    })

    // then
    expect(state.unrecoverableErrorDetected).toBe(true)
    expect(state.tokenLimitDetected).toBeUndefined()
    expect(cancelCalls).toEqual([sessionID])
  })

  test("#given a retryable provider error #when the session error arrives #then the session is not marked unrecoverable", async () => {
    // given
    const sessionID = "ses_retryable_provider_error"
    const { cancelCalls, state, store } = createRecordingStateStore()
    const handler = createTodoContinuationHandler({
      ctx: {} as never,
      sessionStateStore: store,
    })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "APIError", data: { message: "overloaded", statusCode: 529, isRetryable: true } },
        },
      },
    })

    // then
    expect(state.unrecoverableErrorDetected).toBeUndefined()
    expect(cancelCalls).toEqual([])
  })

  test("#given an accepted continuation #when a retryable provider error arrives #then it advances the continuation failure streak", async () => {
    // given
    const sessionID = "ses_retryable_continuation_error"
    const { state, store } = createRecordingStateStore()
    state.awaitingPostInjectionProgressCheck = true
    const handler = createTodoContinuationHandler({
      ctx: {} as never,
      sessionStateStore: store,
    })

    // when
    for (let index = 0; index < MAX_CONSECUTIVE_FAILURES; index++) {
      await handler({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "APIError",
              data: { message: "service unavailable", statusCode: 503, isRetryable: true },
            },
          },
        },
      })
    }

    // then
    expect(state.consecutiveProviderFailures).toBe(MAX_CONSECUTIVE_FAILURES)
    expect(state.consecutiveFailures).toBe(1)
  })

  test("#given an accepted continuation reaches the provider failure limit #when the session becomes idle #then it does not inject another continuation", async () => {
    // given
    const sessionID = "ses_provider_failure_limit_through_handler"
    const { cancelCalls, state, store } = createRecordingStateStore()
    state.awaitingPostInjectionProgressCheck = true
    state.countdownStartedAt = undefined
    state.countdownTimer = undefined
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          todo: async () => ({
            data: [{ id: "todo-1", content: "Ship", status: "pending", priority: "high" }],
          }),
        },
        tui: {
          showToast: async () => ({}),
        },
      },
      directory: "/tmp/test",
    }
    const handler = createTodoContinuationHandler({
      ctx: ctx as never,
      sessionStateStore: store,
    })

    try {
      // when
      for (let index = 0; index < MAX_CONSECUTIVE_FAILURES; index++) {
        await handler({
          event: {
            type: "session.error",
            properties: {
              sessionID,
              error: {
                name: "APIError",
                data: { message: "service unavailable", statusCode: 503, isRetryable: true },
              },
            },
          },
        })
      }
      await handler({ event: { type: "session.idle", properties: { sessionID } } })

      // then
      expect(state.consecutiveProviderFailures).toBe(MAX_CONSECUTIVE_FAILURES)
      expect(cancelCalls).toEqual([])
      expect(state.countdownStartedAt).toBeUndefined()
    } finally {
      store.cancelCountdown(sessionID)
    }
  })
})

describe("createTodoContinuationHandler provider failure bound with real session state", () => {
  const EMPTY_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  const SUBSTANTIVE_TOKENS = { input: 5, output: 31, reasoning: 0, cache: { read: 0, write: 0 } }
  const retryableError = {
    name: "APIError",
    data: { message: "usage limit has been reached", statusCode: 503, isRetryable: true },
  }

  function createContext(): { readonly ctx: never; readonly prompts: string[] } {
    const prompts: string[] = []
    const record = (label: string) => async () => {
      prompts.push(label)
      return {}
    }
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          todo: async () => ({
            data: [{ id: "todo-1", content: "Ship", status: "pending", priority: "high" }],
          }),
          prompt: record("prompt"),
          promptAsync: record("promptAsync"),
        },
        tui: { showToast: async () => ({}) },
      },
      directory: "/tmp/test",
    }
    return { ctx: ctx as never, prompts }
  }

  test("#given repeated post-continuation failures #when session.error then an empty assistant message.updated repeat before idle #then the bound is reached and no continuation is injected", async () => {
    // given
    const sessionID = "ses_bound_through_empty_messages"
    const store = createSessionStateStore()
    const { ctx, prompts } = createContext()
    const handler = createTodoContinuationHandler({ ctx, sessionStateStore: store })
    const state = store.getState(sessionID)

    try {
      // when
      for (let index = 0; index < MAX_CONSECUTIVE_FAILURES; index++) {
        state.awaitingPostInjectionProgressCheck = true
        await handler({ event: { type: "session.error", properties: { sessionID, error: retryableError } } })
        await handler({
          event: {
            type: "message.updated",
            properties: {
              info: {
                id: `msg_empty_${index}`,
                sessionID,
                role: "assistant",
                error: retryableError,
                finish: "unknown",
                tokens: EMPTY_TOKENS,
              },
            },
          },
        })
      }
      await handler({ event: { type: "session.idle", properties: { sessionID } } })

      // then
      expect(state.consecutiveProviderFailures).toBe(MAX_CONSECUTIVE_FAILURES)
      expect(prompts).toEqual([])
    } finally {
      store.shutdown()
    }
  })

  test("#given a failure streak #when a substantive assistant response follows the errors #then the streak is cleared", async () => {
    // given
    const sessionID = "ses_streak_cleared_by_response"
    const store = createSessionStateStore()
    const { ctx } = createContext()
    const handler = createTodoContinuationHandler({ ctx, sessionStateStore: store })
    const state = store.getState(sessionID)
    state.awaitingPostInjectionProgressCheck = true

    try {
      // when
      await handler({ event: { type: "session.error", properties: { sessionID, error: retryableError } } })
      await handler({ event: { type: "session.error", properties: { sessionID, error: retryableError } } })
      const streakBeforeResponse = state.consecutiveProviderFailures
      await handler({
        event: {
          type: "message.updated",
          properties: {
            info: { id: "msg_real", sessionID, role: "assistant", finish: "stop", tokens: SUBSTANTIVE_TOKENS },
          },
        },
      })

      // then
      expect(streakBeforeResponse).toBe(2)
      expect(state.consecutiveProviderFailures).toBe(0)
    } finally {
      store.shutdown()
    }
  })

  test("#given a failure streak in one session #when another session errors and responds #then the first streak is isolated", async () => {
    // given
    const sessionID = "ses_streak_isolation_a"
    const otherSessionID = "ses_streak_isolation_b"
    const store = createSessionStateStore()
    const { ctx } = createContext()
    const handler = createTodoContinuationHandler({ ctx, sessionStateStore: store })
    const state = store.getState(sessionID)
    const otherState = store.getState(otherSessionID)
    state.awaitingPostInjectionProgressCheck = true
    otherState.awaitingPostInjectionProgressCheck = true

    try {
      // when
      await handler({ event: { type: "session.error", properties: { sessionID, error: retryableError } } })
      await handler({ event: { type: "session.error", properties: { sessionID: otherSessionID, error: retryableError } } })
      await handler({
        event: {
          type: "message.updated",
          properties: {
            info: { id: "msg_other_real", sessionID: otherSessionID, role: "assistant", finish: "stop", tokens: SUBSTANTIVE_TOKENS },
          },
        },
      })

      // then
      expect(state.consecutiveProviderFailures).toBe(1)
      expect(otherState.consecutiveProviderFailures).toBe(0)
    } finally {
      store.shutdown()
    }
  })
})
