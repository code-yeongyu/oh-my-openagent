import { describe, expect, test } from "bun:test"
import {
  releaseAllPromptAsyncReservationsForTesting,
} from "../../hooks/shared/prompt-async-gate"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeNotifierClientForTest = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]
type PromptAsyncCall = Parameters<ParentWakeNotifierClientForTest["session"]["promptAsync"]>[0]

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n**Completed:**\n- `task-a`: task A\n- `task-b`: task B\n</system-reminder>"
const PROGRESS_WAKE = "<system-reminder>\n[BACKGROUND TASK RESULT READY]\n**ID:** `task-a`\n**1 task still in progress.** You WILL be notified when ALL complete.\n</system-reminder>"

function createNotifier(): {
  readonly notifier: ParentWakeNotifier
  readonly promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client: ParentWakeNotifierClientForTest = {
    session: {
      messages: async () => ({
        data: [
          {
            info: { role: "assistant", finish: "stop", time: { created: Date.now() - 10_000 } },
          },
        ],
      }),
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return { data: {} }
      },
    },
  }

  return {
    promptAsyncCalls,
    notifier: new ParentWakeNotifier(
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
    ),
  }
}

function getPromptText(call: PromptAsyncCall | undefined): string {
  const firstPart = call?.body.parts?.[0]
  if (!firstPart || typeof firstPart !== "object" || !("text" in firstPart)) {
    throw new Error("Missing text part in promptAsync call")
  }
  return firstPart.text
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe("ParentWakeNotifier final notification merge", () => {
  test("#given a progress wake is pending before final wake #when flushed #then final completion is delivered without stale progress", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-final-supersedes-progress"
    notifier.queuePendingParentWake(sessionID, PROGRESS_WAKE, { agent: "sisyphus" }, false)
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      const notificationText = getPromptText(promptAsyncCalls[0])
      expect(notificationText.startsWith("<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]")).toBe(true)
      expect(notificationText).not.toContain("[BACKGROUND TASK RESULT READY]")
      expect(notificationText).not.toContain("still in progress")
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given duplicate final wakes are pending #when flushed #then the completion reminder appears once", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-final-duplicate-collapse"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      const notificationText = getPromptText(promptAsyncCalls[0])
      expect(countOccurrences(notificationText, "[ALL BACKGROUND TASKS COMPLETE]")).toBe(1)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a final wake is requeued while same final is pending #when recovery runs #then the retry keeps one copy", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-final-requeue-duplicate-collapse"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

      // when
      const requeued = await notifier.requeueDispatchedParentWake(sessionID, "test failure")

      // then
      expect(requeued).toBe(true)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([FINAL_WAKE])
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
