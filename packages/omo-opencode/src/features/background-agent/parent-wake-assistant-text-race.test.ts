/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

type PromptAsyncCall = {
  readonly body: { readonly noReply?: boolean }
}

describe("ParentWakeNotifier — assistant text dispatch race", () => {
  test("#given stale text becomes fresh assistant activity before dispatch #when flushing parent wake #then wake is recorded without forking a reply", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    let messageReadCount = 0
    const promptAsyncCalls: PromptAsyncCall[] = []
    const staleAssistantMessages = [
      {
        info: {
          role: "assistant",
          finish: "unknown",
          time: { created: 90_000 },
        },
        parts: [{ type: "text", text: "old streamed text" }],
      },
    ]
    const freshAssistantMessages = [
      {
        info: {
          role: "assistant",
          finish: "unknown",
          time: { created: 99_000 },
        },
        parts: [{ type: "text", text: "new streamed text" }],
      },
    ]
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => {
          messageReadCount += 1
          return { data: messageReadCount === 1 ? staleAssistantMessages : freshAssistantMessages }
        },
        status: async () => ({ data: { "parent-stale-then-fresh-text": { type: "idle" } } }),
        promptAsync: async (call: PromptAsyncCall) => {
          promptAsyncCalls.push(call)
          return { data: {} }
        },
      },
    })
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
      "parent-stale-then-fresh-text",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-stale-then-fresh-text")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-stale-then-fresh-text")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-stale-then-fresh-text")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
