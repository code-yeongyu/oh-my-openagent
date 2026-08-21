/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

describe("ParentWakeNotifier — assistant history deferral", () => {
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

  test("#given zombie running tool block held under the stale-hold ceiling #when checking parent wake history #then wake stays held", async () => {
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
                  callID: "call_zombie",
                  state: { status: "running" },
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-zombie-tool-under-ceiling": { type: "idle" } } }),
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
        staleToolBlockMaxHoldMs: 10_000,
      },
    )
    notifier.queuePendingParentWake(
      "parent-zombie-tool-under-ceiling",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-zombie-tool-under-ceiling")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 94_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"](
        "parent-zombie-tool-under-ceiling",
        pendingWake,
      )

      // then
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: true })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given zombie running tool block held past the stale-hold ceiling #when checking parent wake history #then wake is force-delivered", async () => {
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
                  callID: "call_zombie_ceiling",
                  state: { status: "running" },
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-zombie-tool-past-ceiling": { type: "idle" } } }),
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
        staleToolBlockMaxHoldMs: 10_000,
      },
    )
    notifier.queuePendingParentWake(
      "parent-zombie-tool-past-ceiling",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-zombie-tool-past-ceiling")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"](
        "parent-zombie-tool-past-ceiling",
        pendingWake,
      )

      // then
      expect(decision).toEqual({ defer: false, skipPromptGateToolStateCheck: true })

      // The pre-dispatch confirmation re-runs the same check; it must reach the
      // same decision instead of re-arming the deferral.
      const confirmedDecision = await notifier["shouldDeferParentWakeForSessionHistory"](
        "parent-zombie-tool-past-ceiling",
        pendingWake,
      )
      expect(confirmedDecision).toEqual({ defer: false, skipPromptGateToolStateCheck: true })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given no stale-hold ceiling configured #when checking a long-held wake against a zombie tool block #then historical unbounded hold is preserved", async () => {
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
                  callID: "call_zombie_no_ceiling",
                  state: { status: "running" },
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { "parent-zombie-tool-no-ceiling": { type: "idle" } } }),
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
      "parent-zombie-tool-no-ceiling",
      "task complete",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-zombie-tool-no-ceiling")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      const decision = await notifier["shouldDeferParentWakeForSessionHistory"](
        "parent-zombie-tool-no-ceiling",
        pendingWake,
      )

      // then
      expect(decision).toEqual({ defer: true, skipPromptGateToolStateCheck: true })
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
