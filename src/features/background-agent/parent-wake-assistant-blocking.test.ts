import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    noReply?: boolean
    agent?: string
    parts?: unknown[]
  }
  query?: {
    directory: string
  }
}
type ParentWakeClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

describe("ParentWakeNotifier — assistant turn blocking", () => {
  test("#given stale unfinished assistant text turn blocks the parent #when flushing pending wake #then stale tool escape does not dispatch", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const promptAsyncCalls: PromptAsyncCall[] = []
    const client: ParentWakeClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                finish: "unknown",
                time: { created: 90_000 },
              },
              parts: [{ type: "reasoning", text: "still streaming" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-unfinished-text": { type: "idle" } } }),
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
        acceptedMessageSkewMs: 5_000,
        toolCallDeferMaxMs: 5_000,
        failureRequeueWindowMs: 5_000,
        userMessageInProgressWindowMs: 2_000,
      },
    )
    notifier.queuePendingParentWake(
      "parent-unfinished-text",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-unfinished-text")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-unfinished-text")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-unfinished-text")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given notifier sees an unfinished assistant but prompt gate message fetch fails #when flushing pending wake #then the wake stays pending", async () => {
    // given
    const promptAsyncCalls: PromptAsyncCall[] = []
    let messageReads = 0
    const client: ParentWakeClient = {
      session: {
        messages: async () => {
          messageReads += 1
          if (messageReads > 1) {
            throw new Error("message fetch failed")
          }
          return {
            data: [
              {
                info: {
                  role: "assistant",
                  finish: "unknown",
                  time: { created: Date.now() - 1_000 },
                },
                parts: [{ type: "reasoning", text: "still streaming" }],
              },
            ],
          }
        },
        status: async () => ({ data: { "parent-local-unknown": { type: "idle" } } }),
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
        acceptedMessageSkewMs: 5_000,
        toolCallDeferMaxMs: 5_000,
        failureRequeueWindowMs: 5_000,
        userMessageInProgressWindowMs: 2_000,
      },
    )
    notifier.queuePendingParentWake(
      "parent-local-unknown",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await notifier.flushPendingParentWake("parent-local-unknown")

    // then
    expect(promptAsyncCalls).toHaveLength(0)
    expect(notifier.getPendingParentWakes().has("parent-local-unknown")).toBe(true)
    expect(messageReads).toBe(1)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })
})
