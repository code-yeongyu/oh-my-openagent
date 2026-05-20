import { describe, expect, test } from "bun:test"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../../hooks/shared/prompt-async-gate"

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

type SessionMessageStub = {
  info?: {
    role?: string
    finish?: string
    time?: { created?: number }
  }
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean; content?: unknown }>
}

function createNotifier(args: {
  sessionMessages?: SessionMessageStub[]
  promptAsyncImpl?: (call: PromptAsyncCall, attempt: number) => Promise<unknown>
} = {}): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const sessionMessages = args.sessionMessages ?? [
    {
      info: {
        role: "assistant",
        finish: "stop",
        time: { created: Date.now() - 10_000 },
      },
    },
  ]
  const client = {
    session: {
      messages: async () => ({ data: sessionMessages }),
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        const attempt = promptAsyncCalls.length
        return args.promptAsyncImpl?.(call, attempt) ?? { data: {} }
      },
      abort: async () => ({ data: {} }),
    },
  } as unknown as ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

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

function releaseParentWakeHold(sessionID: string): void {
  const released = releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
  expect(released).toBe(true)
}

describe("ParentWakeNotifier — same-source reservation requeue (BUG-E)", () => {
  test("#given a parent wake is in post-dispatch hold #when a new pending wake fires within the hold window #then the new wake is re-enqueued and dispatched after the hold expires", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier()
    const sessionID = "parent-hold-new-wake"
    notifier.queuePendingParentWake(sessionID, "wake A", { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)

      // when
      notifier.queuePendingParentWake(sessionID, "wake B", { agent: "sisyphus" }, true)
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual(["wake B"])
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(true)

      releaseParentWakeHold(sessionID)
      await notifier.flushPendingParentWake(sessionID)

      expect(promptAsyncCalls).toHaveLength(2)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a parent wake failed dispatch and is queued for retry #when the retry fires within the hold window of the failed dispatch #then the retry is preserved", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      promptAsyncImpl: async (_call, attempt) => {
        if (attempt === 1) {
          throw new Error("JSON Parse error: Unexpected EOF")
        }
        return { data: {} }
      },
    })
    const sessionID = "parent-failed-retry-during-hold"
    notifier.queuePendingParentWake(sessionID, "retry wake", { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(true)

      // when
      await notifier.flushPendingParentWake(sessionID)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual(["retry wake"])
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(true)

      releaseParentWakeHold(sessionID)
      await notifier.flushPendingParentWake(sessionID)

      expect(promptAsyncCalls).toHaveLength(2)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
