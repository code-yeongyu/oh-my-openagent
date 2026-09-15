import { describe, expect, test } from "bun:test"
import type { PendingParentWake } from "./parent-wake-dedupe"
import { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import {
  extractNotificationHeaders,
  extractNotificationTaskIds,
  nextParentWakeLedgerId,
  summarizeParentWakeForLedger,
} from "./parent-wake-ledger"
import { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import { handleDispatchedParentWakeWindowElapsed } from "./parent-wake-window-recovery"

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"
const PROGRESS_WAKE = [
  "<system-reminder>",
  "[BACKGROUND TASK RESULT READY]",
  "**ID:** `bg_c15f1cdd`",
  "**2 tasks still in progress.** You WILL be notified when ALL complete.",
  "session_id: ses_00842937dffexen2kTWmwE52pQ",
  "</system-reminder>",
].join("\n")

function createQueue(): ParentWakePendingQueue {
  return new ParentWakePendingQueue({
    pendingRetryMs: 1_000,
    enqueueNotificationForParent: async (_sessionID, operation) => {
      await operation()
    },
  })
}

describe("parent-wake-ledger extraction", () => {
  test("#given a system-reminder notification #when extracting headers #then the bracketed header lines are returned", () => {
    // given / when
    const headers = extractNotificationHeaders([FINAL_WAKE])

    // then
    expect(headers).toEqual(["[BACKGROUND TASK COMPLETED]", "[ALL BACKGROUND TASKS COMPLETE]"])
  })

  test("#given notifications with task and session ids #when extracting task ids #then unique ids are returned", () => {
    // given / when
    const taskIds = extractNotificationTaskIds([PROGRESS_WAKE, PROGRESS_WAKE])

    // then
    expect(taskIds).toEqual(["bg_c15f1cdd", "ses_00842937dffexen2kTWmwE52pQ"])
  })

  test("#given a wake without a ledger id #when summarizing #then wakeId reports unassigned", () => {
    // given
    const wake: PendingParentWake = {
      promptContext: {},
      notifications: [FINAL_WAKE],
      shouldReply: true,
      queuedAt: 1_000,
      noAssistantOutputRetryCount: 1,
    }

    // when
    const summary = summarizeParentWakeForLedger(wake)

    // then
    expect(summary["wakeId"]).toBe("unassigned")
    expect(summary["shouldReply"]).toBe(true)
    expect(summary["notificationCount"]).toBe(1)
    expect(summary["queuedAt"]).toBe(1_000)
    expect(summary["noOutputRetries"]).toBe(1)
  })

  test("#given repeated id generation #when generating ledger ids #then ids are unique", () => {
    // given / when
    const ids = new Set([nextParentWakeLedgerId(), nextParentWakeLedgerId(), nextParentWakeLedgerId()])

    // then
    expect(ids.size).toBe(3)
  })
})

describe("parent-wake-ledger id lifecycle in the pending queue", () => {
  test("#given a new wake is queued #when another notification merges into it #then the ledger id is assigned once and retained", () => {
    // given
    const queue = createQueue()
    const sessionID = "ledger-id-lifecycle"
    queue.queueWake(sessionID, PROGRESS_WAKE, {}, false)
    const ledgerId = queue.getWake(sessionID)?.ledgerId

    // when
    queue.queueWake(sessionID, FINAL_WAKE, {}, true)

    // then
    expect(ledgerId).toBeDefined()
    expect(queue.getWake(sessionID)?.ledgerId).toBe(ledgerId as string)
    queue.shutdown()
  })

  test("#given a dispatched wake clone is requeued #when no pending entry exists #then the clone keeps its ledger id", () => {
    // given
    const queue = createQueue()
    const sessionID = "ledger-id-requeue"
    const dispatchedClone: PendingParentWake = {
      promptContext: {},
      notifications: [FINAL_WAKE],
      shouldReply: true,
      dispatchedAt: Date.now(),
      ledgerId: "wake-test-requeue",
    }

    // when
    queue.requeueWake(sessionID, dispatchedClone)

    // then
    expect(queue.getWake(sessionID)?.ledgerId).toBe("wake-test-requeue")
    queue.shutdown()
  })
})

describe("parent-wake window recovery forensics", () => {
  function createRecoveryHarness(): {
    readonly tracker: ParentWakeDispatchedTracker
    readonly inspector: ParentWakeSessionInspector
    readonly messagesCalls: () => number
  } {
    let messagesCallCount = 0
    const tracker = new ParentWakeDispatchedTracker({
      failureRequeueWindowMs: 60_000,
      onFailureRequeueWindowElapsed: () => {},
    })
    const inspector = new ParentWakeSessionInspector(
      {
        session: {
          messages: async () => {
            messagesCallCount += 1
            return { data: [] }
          },
        },
      },
      {
        directory: "/tmp/test-omo",
        acceptedMessageSkewMs: 100,
        toolCallDeferMaxMs: 5_000,
        userMessageInProgressWindowMs: 0,
      },
    )
    return { tracker, inspector, messagesCalls: () => messagesCallCount }
  }

  test("#given a dispatched reply wake past its retry budget #when the recovery window elapses #then it is abandoned with pending state and parent snapshot consulted", async () => {
    // given
    const { tracker, inspector, messagesCalls } = createRecoveryHarness()
    const sessionID = "ledger-abandoned"
    const dispatchedAt = Date.now()
    const wake: PendingParentWake = {
      promptContext: {},
      notifications: [FINAL_WAKE],
      shouldReply: true,
      dispatchedAt,
      noAssistantOutputRetryCount: 1,
      ledgerId: "wake-test-abandoned",
    }
    tracker.trackWake(sessionID, wake, dispatchedAt)
    let pendingConsulted = 0
    const requeued: PendingParentWake[] = []

    // when
    await handleDispatchedParentWakeWindowElapsed({
      sessionID,
      wake: { ...wake },
      dispatchedTracker: tracker,
      sessionInspector: inspector,
      getPendingWake: () => {
        pendingConsulted += 1
        return undefined
      },
      requeueWake: (requeuedWake) => {
        requeued.push(requeuedWake)
      },
      scheduleFlush: () => {},
    })

    // then
    expect(tracker.hasWake(sessionID)).toBe(false)
    expect(requeued).toHaveLength(0)
    expect(pendingConsulted).toBe(1)
    expect(messagesCalls()).toBeGreaterThanOrEqual(2)
    tracker.shutdown()
    inspector.shutdown()
  })

  test("#given a dispatched wake under its retry budget #when the recovery window elapses #then it is requeued instead of abandoned", async () => {
    // given
    const { tracker, inspector } = createRecoveryHarness()
    const sessionID = "ledger-requeue-budget"
    const dispatchedAt = Date.now()
    const wake: PendingParentWake = {
      promptContext: {},
      notifications: [FINAL_WAKE],
      shouldReply: true,
      dispatchedAt,
      ledgerId: "wake-test-budget",
    }
    tracker.trackWake(sessionID, wake, dispatchedAt)
    const requeued: PendingParentWake[] = []

    // when
    await handleDispatchedParentWakeWindowElapsed({
      sessionID,
      wake: { ...wake },
      dispatchedTracker: tracker,
      sessionInspector: inspector,
      getPendingWake: () => undefined,
      requeueWake: (requeuedWake) => {
        requeued.push(requeuedWake)
      },
      scheduleFlush: () => {},
    })

    // then
    expect(requeued).toHaveLength(1)
    expect(requeued[0]?.noAssistantOutputRetryCount).toBe(1)
    expect(requeued[0]?.ledgerId).toBe("wake-test-budget")
    tracker.shutdown()
    inspector.shutdown()
  })
})
