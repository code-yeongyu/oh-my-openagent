import { describe, expect, test } from "bun:test"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../../hooks/shared/prompt-async-gate"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeNotifierClientForTest = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]
type PromptAsyncCall = Parameters<ParentWakeNotifierClientForTest["session"]["promptAsync"]>[0]

type SessionMessageStub = {
  readonly info?: {
    readonly role?: string
    readonly finish?: string
    readonly time?: { readonly created?: number }
  }
  readonly parts?: readonly { readonly type?: string; readonly text?: string }[]
}

type NotifierFixture = {
  readonly notifier: ParentWakeNotifier
  readonly promptAsyncCalls: PromptAsyncCall[]
}

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"

function installThrowingUnrefTimers(): () => void {
  const originalSetTimeout = globalThis.setTimeout
  const throwingSetTimeout: typeof globalThis.setTimeout = (handler, delay) => {
    const timer = originalSetTimeout(handler, delay)
    Object.defineProperty(timer, "unref", {
      configurable: true,
      value: () => {
        const failure = Object.freeze({ message: "timer unref failure" })
        throw failure
      },
    })
    return timer
  }
  globalThis.setTimeout = throwingSetTimeout
  return () => {
    globalThis.setTimeout = originalSetTimeout
  }
}

function createNotifier(args: {
  readonly sessionMessagesImpl?: (attempt: number) => Promise<unknown>
  readonly promptAsyncImpl?: (call: PromptAsyncCall, attempt: number) => Promise<unknown>
} = {}): NotifierFixture {
  const promptAsyncCalls: PromptAsyncCall[] = []
  let messagesAttempt = 0
  const sessionMessages: readonly SessionMessageStub[] = [
    {
      info: {
        role: "assistant",
        finish: "stop",
        time: { created: Date.now() - 10_000 },
      },
    },
  ]
  const client: ParentWakeNotifierClientForTest = {
    session: {
      messages: async () => {
        messagesAttempt += 1
        return args.sessionMessagesImpl?.(messagesAttempt) ?? { data: sessionMessages }
      },
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return args.promptAsyncImpl?.(call, promptAsyncCalls.length) ?? { data: {} }
      },
    },
  }

  const notifier = new ParentWakeNotifier(
    {
      client,
      directory: "/tmp/test-omo",
      enqueueNotificationForParent: async (_sessionID, operation) => {
        await operation()
      },
    },
    {
      pendingRetryMs: 1_000,
      acceptedMessageSkewMs: 100,
      toolCallDeferMaxMs: 5_000,
      failureRequeueWindowMs: 5_000,
      userMessageInProgressWindowMs: 0,
    },
  )

  return { notifier, promptAsyncCalls }
}

function releaseParentWakeHold(sessionID: string): void {
  const released = releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
  expect(released).toBe(true)
}

describe("ParentWakeNotifier non-Error retry recovery", () => {
  test("#given promptAsync rejects with a string after the final wake is dequeued #when the wake flush runs #then the final wake is requeued and retries once", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      promptAsyncImpl: async (_call, attempt) => {
        if (attempt === 1) {
          return Promise.reject("string prompt failure")
        }
        return { data: {} }
      },
    })
    const sessionID = "parent-non-error-prompt-retry"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(true)

      releaseParentWakeHold(sessionID)
      await notifier.flushPendingParentWake(sessionID)

      expect(promptAsyncCalls).toHaveLength(2)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given session.messages rejects with a string after the retry timer is cleared #when the wake flush runs #then the final wake is recorded without a reply", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessagesImpl: async (attempt) => {
        if (attempt === 1) {
          return Promise.reject("string messages failure")
        }
        return {
          data: [
            {
              info: {
                role: "assistant",
                finish: "stop",
                time: { created: Date.now() - 10_000 },
              },
            },
          ] satisfies readonly SessionMessageStub[],
        }
      },
    })
    const sessionID = "parent-non-error-messages-retry"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an accepted final wake has a timer whose unref throws a plain object #when the wake is tracked #then the accepted wake is not requeued or duplicated", async () => {
    // given
    const restoreTimers = installThrowingUnrefTimers()
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-non-error-unref-after-accepted"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)

      releaseParentWakeHold(sessionID)
      await notifier.flushPendingParentWake(sessionID)

      expect(promptAsyncCalls).toHaveLength(1)
    } finally {
      restoreTimers()
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
