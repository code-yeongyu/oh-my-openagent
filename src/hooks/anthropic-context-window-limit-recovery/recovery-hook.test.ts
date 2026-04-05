import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  createRecoveryHook,
  executeCompactMock,
  getLastAssistantMock,
  parseAnthropicTokenLimitErrorMock,
  setupDelayedTimeoutMocks,
} from "./recovery-hook.test-support"

describe("createAnthropicContextWindowLimitRecoveryHook", () => {
  beforeEach(() => {
    executeCompactMock.mockClear()
    getLastAssistantMock.mockClear()
    parseAnthropicTokenLimitErrorMock.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  test("cancels pending timer when session.idle handles compaction first", async () => {
    //#given
    const { restore, getClearTimeoutCalls, getScheduledTimeouts } = setupDelayedTimeoutMocks()
    let compactedSessionID: unknown
    executeCompactMock.mockImplementationOnce(async (...args: unknown[]) => {
      compactedSessionID = args[0]
    })
    const hook = createRecoveryHook()

    try {
      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-race", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-race" },
        },
      })

      //#then
      expect(getClearTimeoutCalls()).toEqual([getScheduledTimeouts()[0]])
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(compactedSessionID).toBe("session-race")
    } finally {
      restore()
    }
  })

  test("does not treat empty summary assistant messages as successful compaction", async () => {
    //#given
    const { restore, getClearTimeoutCalls, getScheduledTimeouts } = setupDelayedTimeoutMocks()
    let compactedSessionID: unknown
    executeCompactMock.mockImplementationOnce(async (...args: unknown[]) => {
      compactedSessionID = args[0]
    })
    getLastAssistantMock.mockResolvedValueOnce({
      info: {
        summary: true,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
      },
      hasContent: false,
    })
    const hook = createRecoveryHook()

    try {
      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-empty-summary", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-empty-summary" },
        },
      })

      //#then
      expect(getClearTimeoutCalls()).toEqual([getScheduledTimeouts()[0]])
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(compactedSessionID).toBe("session-empty-summary")
    } finally {
      restore()
    }
  })

  test("#given active pending and retry timers #when dispose is called #then it clears both timer maps", async () => {
    //#given
    const { createUntrackedTimeout, getClearTimeoutCalls, getScheduledTimeouts, restore, runScheduledTimeout } =
      setupDelayedTimeoutMocks()
    executeCompactMock.mockImplementationOnce(async (...args: Parameters<typeof executeCompactMock>) => {
      const sessionID = args[0]
      const autoCompactState = args[2]

      autoCompactState.retryTimerBySession.set(sessionID, createUntrackedTimeout())
    })
    const hook = createRecoveryHook()

    try {
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-retry", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-pending", error: "prompt is too long" },
        },
      })

      runScheduledTimeout(0)

      const [retryTimer, pendingTimer] = getScheduledTimeouts()

      //#when
      hook.dispose()

      //#then
      expect(getClearTimeoutCalls()).toEqual(expect.arrayContaining([retryTimer, pendingTimer]))
    } finally {
      restore()
    }
  })

})
