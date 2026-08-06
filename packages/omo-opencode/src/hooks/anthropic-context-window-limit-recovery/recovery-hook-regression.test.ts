import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { AutoCompactState } from "./types"
import {
  createRecoveryHook,
  executeCompactMock,
  getLastAssistantMock,
  parseAnthropicTokenLimitErrorMock,
  setupDelayedTimeoutMocks,
} from "./recovery-hook.test-support"

function isAutoCompactState(value: unknown): value is AutoCompactState {
  if (typeof value !== "object" || value === null) {
    return false
  }

  return (
    "pendingCompact" in value &&
    "errorDataBySession" in value &&
    "retryStateBySession" in value &&
    "retryTimerBySession" in value &&
    "truncateStateBySession" in value &&
    "emptyContentAttemptBySession" in value &&
    "compactionInProgress" in value
  )
}

describe("createAnthropicContextWindowLimitRecoveryHook regressions", () => {
  beforeEach(() => {
    executeCompactMock.mockClear()
    getLastAssistantMock.mockClear()
    parseAnthropicTokenLimitErrorMock.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  test("clears older pending compaction timer before scheduling replacement for same session", async () => {
    //#given
    const { restore, getClearTimeoutCalls, getScheduledTimeouts } = setupDelayedTimeoutMocks()
    const hook = createRecoveryHook()

    try {
      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-retry-timer", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-retry-timer", error: "prompt is too long again" },
        },
      })

      const [firstScheduledTimeout] = getScheduledTimeouts()
      if (firstScheduledTimeout === undefined) {
        throw new Error("Expected first scheduled timeout")
      }

      //#then
      expect(getClearTimeoutCalls()).toEqual([firstScheduledTimeout])
      expect(executeCompactMock).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  test("fully clears recovery state when contentful summary already succeeded", async () => {
    //#given
    const {
      restore,
      createUntrackedTimeout,
      getClearTimeoutCalls,
      getScheduledTimeouts,
    } = setupDelayedTimeoutMocks()
    const sessionID = "session-summary-success"
    let retryTimerHandle: ReturnType<typeof setTimeout> | undefined
    let capturedAutoCompactState: AutoCompactState | undefined
    executeCompactMock.mockImplementationOnce(async (...args: unknown[]) => {
      const autoCompactState = args[2]
      if (isAutoCompactState(autoCompactState)) {
        capturedAutoCompactState = autoCompactState
      }
    })

    const hook = createRecoveryHook()

    try {
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID },
        },
      })

      expect(capturedAutoCompactState).toBeDefined()

      capturedAutoCompactState?.retryStateBySession.set(sessionID, {
        attempt: 1,
        lastAttemptTime: Date.now(),
        firstAttemptTime: Date.now(),
      })
      capturedAutoCompactState?.truncateStateBySession.set(sessionID, {
        truncateAttempt: 2,
      })
      capturedAutoCompactState?.emptyContentAttemptBySession.set(sessionID, 3)
      capturedAutoCompactState?.retryTimerBySession.set(
        sessionID,
        (retryTimerHandle = createUntrackedTimeout()),
      )

      getLastAssistantMock.mockResolvedValueOnce({
        info: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
        },
        hasContent: true,
      })
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: "prompt is too long again" },
        },
      })

      getLastAssistantMock.mockResolvedValueOnce({
        info: {
          summary: true,
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
        },
        hasContent: true,
      })

      //#when
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID },
        },
      })

      const [firstScheduledTimeout, secondScheduledTimeout] = getScheduledTimeouts()
      if (
        firstScheduledTimeout === undefined ||
        secondScheduledTimeout === undefined ||
        retryTimerHandle === undefined
      ) {
        throw new Error("Expected scheduled timeout handles")
      }

      //#then
      expect(getClearTimeoutCalls()).toEqual([
        firstScheduledTimeout,
        secondScheduledTimeout,
        retryTimerHandle,
      ])
      expect(capturedAutoCompactState?.pendingCompact.has(sessionID)).toBe(false)
      expect(capturedAutoCompactState?.errorDataBySession.has(sessionID)).toBe(false)
      expect(capturedAutoCompactState?.retryStateBySession.has(sessionID)).toBe(false)
      expect(capturedAutoCompactState?.retryTimerBySession.has(sessionID)).toBe(false)
      expect(capturedAutoCompactState?.truncateStateBySession.has(sessionID)).toBe(false)
      expect(capturedAutoCompactState?.emptyContentAttemptBySession.has(sessionID)).toBe(false)
    } finally {
      restore()
    }
  })
})
