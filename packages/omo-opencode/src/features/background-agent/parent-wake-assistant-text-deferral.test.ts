/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

describe("ParentWakeNotifier — assistant text history deferral", () => {
  test("#given stale unknown-finish assistant text has no pending tool call #when checking parent wake history #then parent wake stops deferring", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                finish: "unknown",
                time: { created: 90_000 },
              },
              parts: [{ type: "text", text: "still streaming" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-stale-text": { type: "idle" } } }),
        promptAsync: async () => {
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
      "parent-stale-text",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-stale-text")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-stale-text", pendingWake)

      // then
      expect(decision).toEqual({ defer: false, skipPromptGateToolStateCheck: true })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given fresh unfinished assistant text has no pending tool call #when checking parent wake history #then parent wake continues deferring", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                finish: "unknown",
                time: { created: 99_000 },
              },
              parts: [{ type: "text", text: "still streaming" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-fresh-text": { type: "idle" } } }),
        promptAsync: async () => {
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
      "parent-fresh-text",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-fresh-text")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 98_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-fresh-text", pendingWake)

      // then
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: false })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given stale deferral but fresh unfinished assistant text #when flushing parent wake #then wake is recorded without forking a reply", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    let promptAsyncCallCount = 0
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                finish: "unknown",
                time: { created: 99_000 },
              },
              parts: [{ type: "text", text: "still streaming" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-fresh-text-flush": { type: "idle" } } }),
        promptAsync: async () => {
          promptAsyncCallCount += 1
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
      "parent-fresh-text-flush",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-fresh-text-flush")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-fresh-text-flush")

      // then
      expect(promptAsyncCallCount).toBe(1)
      expect(notifier.getPendingParentWakes().has("parent-fresh-text-flush")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
