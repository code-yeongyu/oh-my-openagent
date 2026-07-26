import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type NotifierClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]
type PromptAsyncCall = Parameters<NotifierClient["session"]["promptAsync"]>[0]

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"
const ORDINARY_NO_REPLY_WAKE = "<system-reminder>\n[BACKGROUND TASK RESULT READY]\n</system-reminder>"
const FIRST_CHECKPOINT = "<system-reminder>\n[MANAGED BASH CHECKPOINT]\n**Captured bytes:** 10\n</system-reminder>"
const LATEST_CHECKPOINT = "<system-reminder>\n[MANAGED BASH CHECKPOINT]\n**Captured bytes:** 20\n</system-reminder>"
const LATEST_ONLY_KEY = "managed-bash:bg_task_1:att_1:job-1"

function createNotifier(promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>): {
  readonly notifier: ParentWakeNotifier
  readonly promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client: NotifierClient = {
    session: {
      messages: async () => ({
        data: [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() - 10_000 } } }],
      }),
      status: async () => ({ data: {} }),
      promptAsync: async (call) => {
        promptAsyncCalls.push(call)
        return promptAsyncImpl?.(call) ?? { data: {} }
      },
    },
  }
  const notifier = new ParentWakeNotifier(
    {
      client,
      directory: "/tmp/test-omo",
      enqueueNotificationForParent: async (_sessionID, operation) => operation(),
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

describe("managed-bash checkpoint parent wakes", () => {
  test("#given two pending checkpoints for one task attempt and job #when queued #then only the latest checkpoint is retained", () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-latest-checkpoint"

    try {
      notifier.queueLatestParentWake({ sessionID, notification: FIRST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })

      // when
      notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })

      // then
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([LATEST_CHECKPOINT])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a pure checkpoint noReply wake #when accepted #then it is terminal best-effort and is not recovery tracked", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-checkpoint-noreply"
    notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(promptAsyncCalls[0]?.body.parts[0]?.text).toContain("[MANAGED BASH CHECKPOINT]")
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an ordinary noReply background notification #when accepted #then dispatched recovery tracking is preserved", async () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-ordinary-noreply"
    notifier.queuePendingParentWake(sessionID, ORDINARY_NO_REPLY_WAKE, {}, false)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(notifier.getDispatchedParentWakes().get(sessionID)?.notifications).toEqual([ORDINARY_NO_REPLY_WAKE])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given checkpoint progress is mixed with an ordinary noReply notification #when accepted #then the whole wake retains recovery tracking", async () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-mixed-noreply"
    notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })
    notifier.queuePendingParentWake(sessionID, ORDINARY_NO_REPLY_WAKE, {}, false)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(notifier.getDispatchedParentWakes().get(sessionID)?.notifications).toEqual([
        LATEST_CHECKPOINT,
        ORDINARY_NO_REPLY_WAKE,
      ])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given aggregate checkpoints exceed 1 KiB #when flushed #then the exact noReply prompt is bounded and keeps newest progress", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-checkpoint-bound"
    for (let index = 0; index < 12; index += 1) {
      notifier.queueLatestParentWake({
        sessionID,
        notification: `<system-reminder>\n[MANAGED BASH CHECKPOINT]\n**Job:** job-${index}\n**Captured bytes:** ${index}\n${"x".repeat(120)}\n</system-reminder>`,
        promptContext: {},
        latestOnlyKey: `managed-bash:bg_task_1:att_1:job-${index}`,
      })
    }

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      const promptText = promptAsyncCalls[0]?.body.parts[0]?.text ?? ""
      expect(Buffer.byteLength(promptText, "utf8")).toBeLessThanOrEqual(1_024)
      expect(promptText).toContain("**Job:** job-11")
      expect(promptText).not.toContain("**Job:** job-0\n")
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an oversized ordinary wake follows checkpoint progress #when flushed #then checkpoint eviction is not undone", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-oversized-ordinary"
    const oversizedOrdinaryWake = `<system-reminder>\n[BACKGROUND TASK RESULT READY]\n${"x".repeat(1_200)}\n</system-reminder>`
    notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })
    notifier.queuePendingParentWake(sessionID, oversizedOrdinaryWake, {}, false)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      const promptText = promptAsyncCalls[0]?.body.parts[0]?.text ?? ""
      expect(promptText).toContain("[BACKGROUND TASK RESULT READY]")
      expect(promptText).not.toContain("[MANAGED BASH CHECKPOINT]")
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given two latest-only keys reference identical text #when one key is removed #then the other reference retains the notification", () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-identical-checkpoints"
    const otherKey = "managed-bash:bg_task_1:att_1:job-2"
    notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })
    notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: otherKey })

    try {
      // when
      notifier.removeLatestParentWakes(sessionID, [LATEST_ONLY_KEY])

      // then
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([LATEST_CHECKPOINT])
      expect(notifier.getPendingParentWakes().get(sessionID)?.latestOnlyNotifications?.has(otherKey)).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a dispatched wake has identical text under two keys #when one key is removed #then recovery tracking retains the other reference", () => {
    // given
    const tracker = new ParentWakeDispatchedTracker({
      failureRequeueWindowMs: 5_000,
      onFailureRequeueWindowElapsed: () => {},
    })
    const sessionID = "parent-dispatched-identical-checkpoints"
    const otherKey = "managed-bash:bg_task_1:att_1:job-2"
    tracker.trackWake(sessionID, {
      promptContext: {},
      notifications: [LATEST_CHECKPOINT],
      latestOnlyNotifications: new Map([
        [LATEST_ONLY_KEY, LATEST_CHECKPOINT],
        [otherKey, LATEST_CHECKPOINT],
      ]),
      shouldReply: false,
    }, Date.now())

    try {
      // when
      tracker.removeLatestOnlyNotifications(sessionID, [LATEST_ONLY_KEY])

      // then
      expect(tracker.getWake(sessionID)?.notifications).toEqual([LATEST_CHECKPOINT])
      expect(tracker.getWake(sessionID)?.latestOnlyNotifications?.has(otherKey)).toBe(true)
    } finally {
      tracker.shutdown()
    }
  })

  test("#given an old noReply checkpoint is pending #when a reply-required final wake is merged #then reply safety timing starts at escalation", () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-reply-escalation"
    notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })
    const pendingWake = notifier.getPendingParentWakes().get(sessionID)
    if (!pendingWake) throw new Error("expected pending wake")
    pendingWake.queuedAt = Date.now() - 120_000
    pendingWake.noReplyAdmittedAt = 1
    pendingWake.toolCallDeferralStartedAt = 2
    pendingWake.noAssistantOutputRetryCount = 1
    const escalatedAt = Date.now()

    try {
      // when
      notifier.queuePendingParentWake(sessionID, FINAL_WAKE, {}, true)

      // then
      const escalatedWake = notifier.getPendingParentWakes().get(sessionID)
      expect(escalatedWake?.queuedAt).toBeGreaterThanOrEqual(escalatedAt)
      expect(escalatedWake?.noReplyAdmittedAt).toBeUndefined()
      expect(escalatedWake?.toolCallDeferralStartedAt).toBeUndefined()
      expect(escalatedWake?.noAssistantOutputRetryCount).toBeUndefined()
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an older checkpoint is requeued after dispatch failure #when a newer checkpoint is already pending #then requeue preserves only the newer checkpoint", async () => {
    // given
    let rejectDispatch = (_error: Error): void => {}
    let markDispatchStarted = (): void => {}
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve
    })
    const dispatchResult = new Promise<unknown>((_resolve, reject) => {
      rejectDispatch = reject
    })
    const { notifier } = createNotifier(async () => {
      markDispatchStarted()
      return dispatchResult
    })
    const sessionID = "parent-checkpoint-requeue"
    notifier.queueLatestParentWake({ sessionID, notification: FIRST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })
    const flush = notifier.flushPendingParentWake(sessionID)
    await dispatchStarted

    try {
      // when
      notifier.queueLatestParentWake({ sessionID, notification: LATEST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })
      rejectDispatch(new Error("dispatch failed"))
      await flush

      // then
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([LATEST_CHECKPOINT])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given pending checkpoint keys from a failed attempt #when retry purges the attempt #then stale progress is removed", () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-checkpoint-retry"
    notifier.queueLatestParentWake({ sessionID, notification: FIRST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })

    try {
      // when
      notifier.removeLatestParentWakes(sessionID, [LATEST_ONLY_KEY])

      // then
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a checkpoint is pending #when a final task wake is queued #then final supersedes checkpoint progress", () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-final-supersedes-checkpoint"
    notifier.queueLatestParentWake({ sessionID, notification: FIRST_CHECKPOINT, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })

    try {
      // when
      notifier.queuePendingParentWake(sessionID, FINAL_WAKE, {}, true)

      // then
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given terminal checkpoint progress is pending #when a final task wake is queued #then final still supersedes terminal progress", () => {
    // given
    const { notifier } = createNotifier()
    const sessionID = "parent-final-supersedes-terminal-checkpoint"
    const terminalCheckpoint = "<system-reminder>\n[MANAGED BASH CHECKPOINT]\n**Status:** succeeded\n</system-reminder>"
    notifier.queueLatestParentWake({ sessionID, notification: terminalCheckpoint, promptContext: {}, latestOnlyKey: LATEST_ONLY_KEY })

    try {
      // when
      notifier.queuePendingParentWake(sessionID, FINAL_WAKE, {}, true)

      // then
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
