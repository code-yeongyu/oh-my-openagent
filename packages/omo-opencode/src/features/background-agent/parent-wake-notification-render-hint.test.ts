import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeNotifierClientForTest = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]
type PromptAsyncCall = Parameters<ParentWakeNotifierClientForTest["session"]["promptAsync"]>[0]

const WAKE =
  "<system-reminder>\n[BACKGROUND TASK RESULT READY]\n**ID:** `task-a`\n**1 task still in progress.** You WILL be notified when ALL complete.\n</system-reminder>"

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

function getPart(call: PromptAsyncCall | undefined) {
  const firstPart = call?.body.parts?.[0]
  if (!firstPart || typeof firstPart !== "object" || !("text" in firstPart)) {
    throw new Error("Missing text part in promptAsync call")
  }
  return firstPart
}

describe("ParentWakeNotifier render hint", () => {
  test("#given a wake that should reply #when dispatched #then the part asks the client to render markdown", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-render-hint-reply"
    notifier.queuePendingParentWake(sessionID, WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(getPart(promptAsyncCalls[0])).toMatchObject({ metadata: { render: "markdown" } })
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a no-reply wake #when dispatched #then the render hint survives the no-reply marker", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-render-hint-noreply"
    notifier.queuePendingParentWake(sessionID, WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(getPart(promptAsyncCalls[0])).toMatchObject({ metadata: { render: "markdown" } })
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
