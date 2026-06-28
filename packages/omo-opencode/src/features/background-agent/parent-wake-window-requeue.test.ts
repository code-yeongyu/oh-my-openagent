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

type PendingWakeForTest = {
  readonly deliveryState?: {
    readonly kind: string
    readonly reason?: string
  }
  readonly notifications: readonly string[]
}

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"

function createNotifier(options: {
  readonly onPendingWakeRequeued?: (sessionID: string) => void
} = {}): {
  readonly notifier: ParentWakeNotifier
  readonly promptAsyncCalls: readonly PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
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
      messages: async () => ({ data: sessionMessages }),
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return { data: {} }
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
      ...(options.onPendingWakeRequeued ? { onPendingWakeRequeued: options.onPendingWakeRequeued } : {}),
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

async function waitForTimer(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10)
  })
}

function releaseParentWakeHold(sessionID: string): void {
  const released = releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
  expect(released).toBe(true)
}

describe("ParentWakeNotifier dispatched wake recovery", () => {
  test("#given prompt gate reports an active parent after idle check #when a reply wake flushes #then the wake is requeued with the gate reason", async () => {
    // given
    const promptAsyncCalls: PromptAsyncCall[] = []
    let statusCalls = 0
    const client: ParentWakeNotifierClientForTest = {
      session: {
        messages: async () => ({ data: [] }),
        status: async () => {
          statusCalls += 1
          return { data: { "parent-active-at-gate": { type: statusCalls <= 2 ? "idle" : "busy" } } }
        },
        promptAsync: async (call: PromptAsyncCall) => {
          promptAsyncCalls.push(call)
          return { data: {} }
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
    const sessionID = "parent-active-at-gate"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      const pendingWake = notifier.getPendingParentWakes().get(sessionID) as PendingWakeForTest | undefined
      expect(pendingWake?.deliveryState).toEqual({ kind: "requeued", reason: "prompt-gate-active" })
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a parent wake is accepted but produces no assistant output #when the recovery window elapses #then the wake is requeued for another dispatch", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-window-no-continuation"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)

      // when
      await waitForTimer()

      // then
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      const pendingWake = notifier.getPendingParentWakes().get(sessionID) as PendingWakeForTest | undefined
      expect(pendingWake?.notifications).toEqual([FINAL_WAKE])
      expect(pendingWake?.deliveryState).toEqual({ kind: "requeued", reason: "no-assistant-output" })
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a parent wake is accepted but produces no assistant output #when recovery requeues it #then the manager callback fires before the retry timer settles", async () => {
    // given
    const requeuedSessionIDs: string[] = []
    const { notifier, promptAsyncCalls } = createNotifier({
      onPendingWakeRequeued: (sessionID) => {
        requeuedSessionIDs.push(sessionID)
      },
    })
    const sessionID = "parent-window-requeue-callback"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)

      // when
      await waitForTimer()

      // then
      expect(requeuedSessionIDs).toEqual([sessionID])
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a requeued parent wake still produces no assistant output #when the retry window elapses #then the wake is not retried forever", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-window-no-continuation-retry-budget"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      await waitForTimer()
      expect(notifier.getPendingParentWakes().get(sessionID)?.noAssistantOutputRetryCount).toBe(1)

      releaseParentWakeHold(sessionID)
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(2)

      // when
      await waitForTimer()

      // then
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(false)
      expect(promptAsyncCalls).toHaveLength(2)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
