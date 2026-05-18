import { describe, expect, test } from "bun:test"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    noReply?: boolean
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
}

function createNotifier(args: {
  sessionStatuses?: Record<string, { type: string }>
  sessionMessages: SessionMessageStub[]
  userMessageInProgressWindowMs?: number
}): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      messages: async () => ({ data: args.sessionMessages }),
      status: async () => ({ data: args.sessionStatuses ?? {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return { data: {} }
      },
      abort: async () => ({ data: {} }),
    },
  } as unknown as Parameters<typeof ParentWakeNotifier>[0] extends never
    ? never
    : ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

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
      userMessageInProgressWindowMs: args.userMessageInProgressWindowMs ?? 2_000,
    },
  )

  return { notifier, promptAsyncCalls }
}

describe("ParentWakeNotifier — user message race guard (issue #4120)", () => {
  test("#given latest message is a user message just added #when flushing pending wake #then dispatch is deferred (no promptAsync)", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: Date.now() - 10_000 },
          },
        },
        {
          info: {
            role: "user",
            time: { created: Date.now() - 100 },
          },
        },
      ],
    })
    notifier.queuePendingParentWake(
      "parent-1",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await notifier.flushPendingParentWake("parent-1")

    // then
    expect(promptAsyncCalls).toHaveLength(0)
    expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given latest message is an assistant message #when flushing pending wake #then dispatch proceeds", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "user",
            time: { created: Date.now() - 60_000 },
          },
        },
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: Date.now() - 100 },
          },
        },
      ],
    })
    notifier.queuePendingParentWake(
      "parent-2",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await notifier.flushPendingParentWake("parent-2")

    // then
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.path.id).toBe("parent-2")

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given user message is older than the race window #when flushing pending wake #then dispatch proceeds", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "user",
            time: { created: Date.now() - 5_000 },
          },
        },
      ],
      userMessageInProgressWindowMs: 2_000,
    })
    notifier.queuePendingParentWake(
      "parent-3",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await notifier.flushPendingParentWake("parent-3")

    // then
    expect(promptAsyncCalls).toHaveLength(1)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given race window is disabled (0 ms) #when flushing #then guard is skipped even for fresh user message", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "user",
            time: { created: Date.now() - 10 },
          },
        },
      ],
      userMessageInProgressWindowMs: 0,
    })
    notifier.queuePendingParentWake(
      "parent-4",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await notifier.flushPendingParentWake("parent-4")

    // then
    expect(promptAsyncCalls).toHaveLength(1)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })
})
