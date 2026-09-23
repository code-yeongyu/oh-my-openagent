import { describe, expect, test } from "bun:test"

import { ParentWakeNotifier } from "./parent-wake-notifier"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"

type PromptAsyncCall = {
  path: { id: string }
  body: { noReply?: boolean; agent?: string; parts?: Array<{ type?: string; text?: string; synthetic?: boolean }> }
  query?: { directory: string }
}

function createNotifier(promptAsyncImpl: (call: PromptAsyncCall) => Promise<unknown>): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client: ConstructorParameters<typeof ParentWakeNotifier>[0]["client"] = {
    session: {
      messages: async () => ({
        data: [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() - 10_000 } } }],
      }),
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return promptAsyncImpl(call)
      },
      abort: async () => ({ data: {} }),
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
      acceptedMessageSkewMs: 100,
      toolCallDeferMaxMs: 5_000,
      failureRequeueWindowMs: 5_000,
      userMessageInProgressWindowMs: 0,
    },
  )

  return { notifier, promptAsyncCalls }
}

describe("sendParentWakePrompt — OpenCode synthetic marking (#5544)", () => {
  test("#given a reply wake is flushed #when the prompt is dispatched #then every text part is synthetic so OpenCode's ensureTitle real-user count is not defeated", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier(async () => ({ data: {} }))
    const sessionID = "parent-wake-synthetic-reply"
    notifier.queuePendingParentWake(sessionID, "wake A", { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      const parts = promptAsyncCalls[0]?.body.parts ?? []
      expect(parts.length).toBeGreaterThan(0)
      for (const part of parts) {
        expect(part.synthetic).toBe(true)
        expect(part.text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
      }
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a noReply wake is flushed #when the prompt is dispatched #then its text part is synthetic and keeps the internal marker", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier(async () => ({ data: {} }))
    const sessionID = "parent-wake-synthetic-noreply"
    notifier.queuePendingParentWake(sessionID, "wake B", { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      const parts = promptAsyncCalls[0]?.body.parts ?? []
      expect(parts.length).toBeGreaterThan(0)
      for (const part of parts) {
        expect(part.synthetic).toBe(true)
        expect(part.text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
      }
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
