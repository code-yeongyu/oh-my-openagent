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
    readonly error?: unknown
    readonly time?: { readonly created?: number }
  }
  readonly parts?: readonly { readonly type?: string; readonly text?: string }[]
}

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"

function createNotifier(args: {
  readonly sessionMessagesImpl?: (attempt: number) => Promise<unknown>
  readonly promptAsyncImpl?: (call: PromptAsyncCall, attempt: number) => Promise<unknown>
} = {}): {
  readonly notifier: ParentWakeNotifier
  readonly promptAsyncCalls: PromptAsyncCall[]
} {
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
      failureRequeueWindowMs: 1,
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

async function waitForTimer(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10)
  })
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await waitForTimer()
  }
  expect(predicate()).toBe(true)
}

describe("ParentWakeNotifier late error recovery", () => {
  test("#given session.error arrives after the recovery window #when no assistant output accepted the wake #then the final wake is still requeued", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-late-session-error-after-window"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      await waitForTimer()

      // when
      const requeued = await notifier.requeueDispatchedParentWake(sessionID, "late session.error")

      // then
      expect(requeued).toBe(true)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      releaseParentWakeHold(sessionID)
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(2)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given only the injected user wake is visible #when late session.error arrives #then the wake is requeued instead of treated as accepted", async () => {
    // given
    const sessionMessages: SessionMessageStub[] = [
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: 500 },
        },
      },
    ]
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessagesImpl: async () => ({ data: sessionMessages }),
      promptAsyncImpl: async () => {
        sessionMessages.push({
          info: { role: "user", time: { created: Date.now() } },
          parts: [{ type: "text", text: FINAL_WAKE }],
        })
        return { data: {} }
      },
    })
    const sessionID = "parent-late-error-user-wake-only"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(true)

      // when
      const requeued = await notifier.requeueDispatchedParentWake(sessionID, "late session.error")

      // then
      expect(requeued).toBe(true)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given assistant error history has no parts #when late session.error arrives #then the wake is requeued", async () => {
    // given
    const sessionMessages: SessionMessageStub[] = [
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: 500 },
        },
      },
    ]
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessagesImpl: async () => ({ data: sessionMessages }),
    })
    const sessionID = "parent-late-error-assistant-error-history"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      const wake = notifier.getDispatchedParentWakes().get(sessionID)
      if (!wake) {
        throw new Error("Missing dispatched parent wake")
      }
      wake.dispatchedAt = 1_000
      sessionMessages.push({
        info: {
          role: "assistant",
          finish: "error",
          error: { message: "provider failed after accepting promptAsync" },
          time: { created: 2_000 },
        },
      })

      // when
      const requeued = await notifier.requeueDispatchedParentWake(sessionID, "late session.error")

      // then
      expect(requeued).toBe(true)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given assistant output appears after the recovery window #when the wake timer inspects history #then the dispatched wake is cleared", async () => {
    // given
    let showAcceptedAssistantOutput = false
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessagesImpl: async () => ({
        data: [
          {
            info: {
              role: "assistant",
              finish: "stop",
              time: { created: Date.now() - 10_000 },
            },
          },
          ...(showAcceptedAssistantOutput
            ? [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() } } }]
            : []),
        ] satisfies readonly SessionMessageStub[],
      }),
    })
    const sessionID = "parent-late-window-accepted-output"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(true)

      // when
      showAcceptedAssistantOutput = true
      await waitForTimer()

      // then
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getDispatchedParentWakeTimers().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given history inspection fails after the recovery window #when a later inspection sees assistant output #then the dispatched wake is eventually cleared", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessagesImpl: async (attempt) => {
        if (attempt === 2) {
          throw new Error("transient history read failure")
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
            ...(attempt >= 3 ? [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() } } }] : []),
          ] satisfies readonly SessionMessageStub[],
        }
      },
    })
    const sessionID = "parent-window-inspection-retry"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(true)

      // when/then
      await waitUntil(() => !notifier.getDispatchedParentWakes().has(sessionID), 600)
      expect(notifier.getDispatchedParentWakeTimers().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
