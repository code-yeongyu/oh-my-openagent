/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

describe("ParentWakeNotifier — assistant history deferral", () => {
  test("#given stale unfinished assistant text has no pending tool call #when checking parent wake history #then parent wake keeps deferring", async () => {
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
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: false })
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

  test("#given parent session messages cannot be inspected #when checking parent wake history #then parent wake stays deferred", async () => {
    // given
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => {
          throw new Error("message endpoint failed")
        },
        status: async () => ({ data: { "parent-message-error": { type: "idle" } } }),
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
      "parent-message-error",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-message-error")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-message-error", pendingWake)

      // then
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: false })
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given old assistant turn has recent running tool activity #when checking parent wake history #then stale tool escape stays deferred", async () => {
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
                finish: "tool-calls",
                time: { created: 80_000 },
              },
              parts: [
                {
                  type: "tool",
                  tool: "bash",
                  time: { start: 99_000, end: 99_500 },
                  state: { status: "running" },
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-fresh-tool-activity": { type: "idle" } } }),
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
      "parent-fresh-tool-activity",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-fresh-tool-activity")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-fresh-tool-activity", pendingWake)

      // then
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: false })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given old assistant turn has recent state-level tool activity #when checking parent wake history #then stale tool escape stays deferred", async () => {
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
                finish: "tool-calls",
                time: { created: 80_000 },
              },
              parts: [
                {
                  type: "tool",
                  tool: "bash",
                  state: { status: "running", time: { updated: 99_500 } },
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-fresh-tool-state-activity": { type: "idle" } } }),
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
      "parent-fresh-tool-state-activity",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-fresh-tool-state-activity")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"](
        "parent-fresh-tool-state-activity",
        pendingWake,
      )

      // then
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: false })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
