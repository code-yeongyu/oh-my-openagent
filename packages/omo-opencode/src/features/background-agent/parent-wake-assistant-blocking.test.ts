/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import {
  OMO_INTERNAL_INITIATOR_MARKER,
  OMO_INTERNAL_NOREPLY_MARKER,
} from "../../shared/internal-initiator-marker"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
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
  test("#given notifier sees an unfinished assistant but prompt gate message fetch fails #when flushing pending wake #then wake is recorded without forking a reply", async () => {
    // given
    const promptAsyncCalls: PromptAsyncCall[] = []
    let messageReads = 0
    const client = unsafeTestValue<ParentWakeClient>({
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
      "parent-local-unknown",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await notifier.flushPendingParentWake("parent-local-unknown")

    // then
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
    expect(notifier.getPendingParentWakes().has("parent-local-unknown")).toBe(true)
    expect(messageReads).toBe(1)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given stale completed assistant question tool has no real user answer #when flushing pending wake #then wake is recorded without forking a reply", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const promptAsyncCalls: PromptAsyncCall[] = []
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "user",
                time: { created: 10_000 },
              },
              parts: [{ type: "text", text: "start work" }],
            },
            {
              info: {
                role: "assistant",
                finish: "tool-calls",
                time: { created: 20_000, completed: 99_000 },
              },
              parts: [
                {
                  type: "tool",
                  tool: "question",
                  state: { status: "error" },
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-question-unanswered": { type: "idle" } } }),
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
      "parent-question-unanswered",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-question-unanswered")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 1_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-question-unanswered")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-question-unanswered")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given stale completed unknown assistant turn has only step metadata #when flushing pending wake #then wake is recorded without forking a reply", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const promptAsyncCalls: PromptAsyncCall[] = []
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "user",
                time: { created: 10_000 },
              },
              parts: [{ type: "text", text: "start work" }],
            },
            {
              info: {
                role: "assistant",
                finish: "unknown",
                time: { created: 20_000, completed: 30_000 },
              },
              parts: [
                { type: "step-start" },
                { type: "step-finish", reason: "unknown" },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-completed-unknown": { type: "idle" } } }),
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
      "parent-completed-unknown",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-completed-unknown")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 1_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-completed-unknown")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-completed-unknown")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a completed assistant followed by stacked noReply notification tails #when flushing a shouldReply wake #then it dispatches immediately instead of deadlocking", async () => {
    // given
    const noReplyTailText = `task done\n${OMO_INTERNAL_INITIATOR_MARKER}\n${OMO_INTERNAL_NOREPLY_MARKER}`
    const promptAsyncCalls: PromptAsyncCall[] = []
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                finish: "stop",
                time: { created: 1_000, completed: 2_000 },
              },
              parts: [{ type: "text", text: "fired the background tasks" }],
            },
            {
              info: { role: "user", time: { created: 3_000 } },
              parts: [{ type: "text", text: noReplyTailText, synthetic: true }],
            },
            {
              info: { role: "user", time: { created: 4_000 } },
              parts: [{ type: "text", text: noReplyTailText, synthetic: true }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-noreply-tail": { type: "idle" } } }),
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
      "parent-noreply-tail",
      "[ALL BACKGROUND TASKS COMPLETE]",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-noreply-tail")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBeFalsy()
      expect(notifier.getPendingParentWakes().has("parent-noreply-tail")).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
