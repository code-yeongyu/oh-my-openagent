import { describe, expect, test } from "bun:test"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"

type PromptAsyncCall = {
  path: { id: string }
  body: { noReply?: boolean; agent?: string; parts?: unknown[] }
  query?: { directory: string }
}

function createNotifier(
  promptAsyncImpl: (call: PromptAsyncCall) => Promise<unknown>,
  messagesImpl: () => Promise<unknown> = async () => ({
    data: [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() - 10_000 } } }],
  }),
): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client: ConstructorParameters<typeof ParentWakeNotifier>[0]["client"] = {
    session: {
      messages: messagesImpl,
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return promptAsyncImpl(call)
      },
      abort: async () => ({ data: {} }),
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

describe("ParentWakeNotifier — in-flight dispatch tracking (P1 race)", () => {
  test("#given a parent wake is mid-dispatch #when the pending entry is gone and dispatched is not yet tracked #then hasInFlightParentWakeDispatch still reports the owed wake", async () => {
    // given: a dispatch that blocks until we release it, simulating the multi-second
    // prompt-gate + dispatch window during which the wake is in neither map.
    let releaseDispatch: (() => void) | undefined
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    let signalDispatchStarted: (() => void) | undefined
    const dispatchStarted = new Promise<void>((resolve) => {
      signalDispatchStarted = resolve
    })
    const { notifier } = createNotifier(async () => {
      signalDispatchStarted?.()
      await dispatchGate
      return { data: {} }
    })
    const sessionID = "parent-inflight-dispatch"
    notifier.queuePendingParentWake(sessionID, "wake A", { agent: "sisyphus" }, true)

    try {
      // when: kick off the flush but do not await it; wait until the dispatch await
      // is actually entered (pending deleted, dispatched not yet tracked).
      const flushPromise = notifier.flushPendingParentWake(sessionID)
      await dispatchStarted

      // then: the pending entry has been deleted and the dispatched entry is not yet
      // tracked, so the legacy three-map check would report "no wake owed"...
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(false)
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      // ...but the in-flight marker bridges the gap.
      expect(notifier.hasInFlightParentWakeDispatch(sessionID)).toBe(true)

      // when: the dispatch completes.
      releaseDispatch?.()
      await flushPromise

      // then: the marker is cleared and the wake is now tracked as dispatched,
      // so the owed-wake signal is continuous across the whole window.
      expect(notifier.hasInFlightParentWakeDispatch(sessionID)).toBe(false)
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(true)
    } finally {
      releaseDispatch?.()
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a dispatch throws mid-flight #when it is requeued #then the in-flight marker is cleared without leaking", async () => {
    const { notifier } = createNotifier(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const sessionID = "parent-inflight-dispatch-failure"
    notifier.queuePendingParentWake(sessionID, "wake A", { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)

      // The in-flight marker must not leak after a failed dispatch; the wake is
      // instead requeued into the pending map for retry.
      expect(notifier.hasInFlightParentWakeDispatch(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a parent wake is mid-dispatch #when shutdown wins #then late dispatch completion cannot recreate wake state", async () => {
    // #given
    let releaseDispatch: (() => void) | undefined
    const dispatchGate = new Promise<void>((resolve) => { releaseDispatch = resolve })
    let signalDispatchStarted: (() => void) | undefined
    const dispatchStarted = new Promise<void>((resolve) => { signalDispatchStarted = resolve })
    const { notifier } = createNotifier(async () => {
      signalDispatchStarted?.()
      await dispatchGate
      return { data: {} }
    })
    const sessionID = "parent-shutdown-mid-dispatch"
    notifier.queuePendingParentWake(sessionID, "wake A", { agent: "sisyphus" }, true)

    // #when
    const flushPromise = notifier.flushPendingParentWake(sessionID)
    await dispatchStarted
    notifier.shutdown()
    releaseDispatch?.()
    await flushPromise

    // #then
    expect(notifier.hasInFlightParentWakeDispatch(sessionID)).toBe(false)
    expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
    expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
    expect(notifier.getDispatchedParentWakeTimers().has(sessionID)).toBe(false)
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given parent wake history inspection is in flight #when shutdown starts #then prompt dispatch never begins", async () => {
    // #given
    let releaseHistory: (() => void) | undefined
    const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve })
    let signalHistoryStarted: (() => void) | undefined
    const historyStarted = new Promise<void>((resolve) => { signalHistoryStarted = resolve })
    let messagesCalls = 0
    const { notifier, promptAsyncCalls } = createNotifier(
      async () => ({ data: {} }),
      async () => {
        messagesCalls += 1
        if (messagesCalls === 1) {
          signalHistoryStarted?.()
          await historyGate
        }
        return {
          data: [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() - 10_000 } } }],
        }
      },
    )
    const sessionID = "parent-shutdown-during-history-inspection"
    notifier.queuePendingParentWake(sessionID, "wake A", { agent: "sisyphus" }, true)

    // #when
    const flushPromise = notifier.flushPendingParentWake(sessionID)
    await historyStarted
    notifier.shutdown()
    releaseHistory?.()
    await flushPromise

    // #then
    expect(messagesCalls).toBeGreaterThanOrEqual(1)
    expect(promptAsyncCalls).toHaveLength(0)
    expect(notifier.hasInFlightParentWakeDispatch(sessionID)).toBe(false)
    releaseAllPromptAsyncReservationsForTesting()
  })
})

describe("ParentWakeNotifier — notification-preparation reservation (teardown gap)", () => {
  test("#given two concurrent child teardowns reserve the same parent #when only one releases #then the reservation still reports an owed wake", () => {
    const { notifier } = createNotifier(async () => ({ data: {} }))
    const sessionID = "parent-notification-prep"
    try {
      // given: nothing reserved.
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(false)

      // when: two children of the same parent each begin their teardown.
      notifier.reserveNotificationPreparation(sessionID)
      notifier.reserveNotificationPreparation(sessionID)
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(true)

      // when: only the first child finishes queuing its wake.
      notifier.releaseNotificationPreparation(sessionID)
      // then: the second child is still preparing, so a wake is still owed — a
      // Set would have cleared here and reopened the race.
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(true)

      // when: the second child finishes too.
      notifier.releaseNotificationPreparation(sessionID)
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given more releases than reserves #then the counter never underflows into a stuck reservation", () => {
    const { notifier } = createNotifier(async () => ({ data: {} }))
    const sessionID = "parent-notification-prep-underflow"
    try {
      // A stray release before any reserve must be a no-op.
      notifier.releaseNotificationPreparation(sessionID)
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(false)

      // A reserve/release pair plus an extra release must not leave a negative
      // counter that a later reserve could never clear.
      notifier.reserveNotificationPreparation(sessionID)
      notifier.releaseNotificationPreparation(sessionID)
      notifier.releaseNotificationPreparation(sessionID)
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(false)

      notifier.reserveNotificationPreparation(sessionID)
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(true)
      notifier.releaseNotificationPreparation(sessionID)
      expect(notifier.hasNotificationPreparation(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
