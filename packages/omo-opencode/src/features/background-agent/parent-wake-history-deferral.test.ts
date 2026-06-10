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

  test("#given completed assistant turn followed by synthetic internal user message with noReply admitted #when deferral has timed out #then escape fires and stops deferring", async () => {
    // This test covers the deadlock where:
    // 1. Agent finished normally (no pending tools)
    // 2. Background tasks completed -> admit-only noReply notification was sent
    // 3. latestAssistantTurnBlocksInternalPrompt returns true because
    //    there's an unanswered synthetic user message with no assistant after it
    // 4. Without the fix, this loops forever because there's no tool block to trigger stale-tool escape
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "user", time: { created: 80_000 } },
              parts: [{ type: "text", text: "start work" }],
            },
            {
              info: { role: "assistant", finish: "stop", time: { created: 85_000 } },
              parts: [{ type: "text", text: "I delegated to background agents" }],
            },
            {
              // This is the admit-only noReply notification (synthetic/internal user message)
              info: { role: "user", time: { created: 92_000 } },
              parts: [{ type: "text", text: "<system-reminder>\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-noreply-deadlock": { type: "idle" } } }),
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
      "parent-noreply-deadlock",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-noreply-deadlock")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    // Simulate: deferral started 6s ago (past the 5s toolCallDeferMaxMs)
    pendingWake.toolCallDeferralStartedAt = 94_000
    // Simulate: noReply admission was already recorded
    pendingWake.noReplyAdmittedAt = 95_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-noreply-deadlock", pendingWake)

      // then: the new escape fires — no longer defers infinitely
      expect(decision).toEqual({ defer: false, skipPromptGateToolStateCheck: true })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given completed assistant turn followed by synthetic internal user message WITHOUT noReply admitted #when deferral has timed out #then escape does NOT fire", async () => {
    // Negative test: without noReplyAdmittedAt the escape should NOT fire.
    // This ensures we only break the deadlock for the specific admit-only scenario.
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "user", time: { created: 80_000 } },
              parts: [{ type: "text", text: "start work" }],
            },
            {
              info: { role: "assistant", finish: "stop", time: { created: 85_000 } },
              parts: [{ type: "text", text: "I delegated to background agents" }],
            },
            {
              info: { role: "user", time: { created: 92_000 } },
              parts: [{ type: "text", text: "<system-reminder>\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-noreply-no-admit": { type: "idle" } } }),
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
      "parent-noreply-no-admit",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-noreply-no-admit")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    // Deferral timed out but NO noReplyAdmittedAt set
    pendingWake.toolCallDeferralStartedAt = 94_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-noreply-no-admit", pendingWake)

      // then: should still defer (escape does NOT fire without noReplyAdmittedAt)
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: false })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given assistant turn with active tool block and noReply admitted #when deferral has timed out #then stale-tool escape fires instead of noReply escape", async () => {
    // When there IS a tool block, the existing stale-tool escape should handle it,
    // not the new noReply admission escape.
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const client = unsafeTestValue<ParentWakeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "user", time: { created: 80_000 } },
              parts: [{ type: "text", text: "start work" }],
            },
            {
              info: { role: "assistant", finish: "tool-calls", time: { created: 85_000 } },
              parts: [{ type: "tool", state: { status: "complete" } }],
            },
            {
              info: { role: "user", time: { created: 92_000 } },
              parts: [{ type: "text", text: "<system-reminder>\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->" }],
            },
          ],
        }),
        status: async () => ({ data: { "parent-tool-block-with-admit": { type: "idle" } } }),
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
      "parent-tool-block-with-admit",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-tool-block-with-admit")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 94_000
    pendingWake.noReplyAdmittedAt = 95_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"]("parent-tool-block-with-admit", pendingWake)

      // then: the stale-tool escape fires (latestAssistantTurnHasToolBlock is true),
      // not the noReply admission escape
      expect(decision).toEqual({ defer: false, skipPromptGateToolStateCheck: true })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
