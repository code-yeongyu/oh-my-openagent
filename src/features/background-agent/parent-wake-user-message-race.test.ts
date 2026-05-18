import { describe, expect, test } from "bun:test"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    noReply?: boolean
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    tools?: Record<string, boolean>
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
      acceptedMessageSkewMs: 5_000,
      toolCallDeferMaxMs: 5_000,
      failureRequeueWindowMs: 5_000,
      userMessageInProgressWindowMs: args.userMessageInProgressWindowMs ?? 2_000,
    },
  )

  return { notifier, promptAsyncCalls }
}

describe("ParentWakeNotifier — user message race guard (issue #4120)", () => {
  test("#given user message was created exactly at the race-window boundary #when flushing pending wake #then dispatch is still deferred", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 10_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "user",
            time: { created: 8_000 },
          },
        },
      ],
      userMessageInProgressWindowMs: 2_000,
    })
    notifier.queuePendingParentWake(
      "parent-boundary",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-boundary")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-boundary")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given user message is just outside the race-window boundary #when flushing pending wake #then dispatch proceeds", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 10_001
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "user",
            time: { created: 8_000 },
          },
        },
      ],
      userMessageInProgressWindowMs: 2_000,
    })
    notifier.queuePendingParentWake(
      "parent-boundary-open",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-boundary-open")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has("parent-boundary-open")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given two flushes race for one pending wake #when both reach the prompt gate #then the skipped duplicate is not requeued", async () => {
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
      ],
    })
    notifier.queuePendingParentWake(
      "parent-concurrent",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await Promise.all([
      notifier.flushPendingParentWake("parent-concurrent"),
      notifier.flushPendingParentWake("parent-concurrent"),
    ])

    // then
    expect(promptAsyncCalls).toHaveLength(1)
    expect(notifier.getPendingParentWakes().has("parent-concurrent")).toBe(false)
    expect(notifier.getPendingParentWakeTimers().has("parent-concurrent")).toBe(false)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given burst notifications share a parent session #when the pending wake flushes #then one dispatch drains the coalesced wake", async () => {
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
      ],
    })
    notifier.queuePendingParentWake(
      "parent-burst",
      "task one complete",
      { agent: "sisyphus" },
      false,
    )
    notifier.queuePendingParentWake(
      "parent-burst",
      "task two complete",
      { agent: "sisyphus" },
      true,
    )

    // when
    await Promise.all([
      notifier.flushPendingParentWake("parent-burst"),
      notifier.flushPendingParentWake("parent-burst"),
    ])

    // then
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
    expect(notifier.getPendingParentWakes().has("parent-burst")).toBe(false)
    expect(notifier.getPendingParentWakeTimers().has("parent-burst")).toBe(false)

    notifier.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
  })

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

  test("#given pending wake has parent prompt context #when flushing #then promptAsync receives the context", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
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
      "parent-context",
      "task retrying",
      {
        agent: "hephaestus",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "xhigh",
        tools: { bash: true, edit: false },
      },
      false,
    )

    // when
    await notifier.flushPendingParentWake("parent-context")

    // then
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.body).toMatchObject({
      noReply: true,
      agent: "hephaestus",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "xhigh",
      tools: { bash: true, edit: false },
    })
    expect(promptAsyncCalls[0]?.body.parts).toHaveLength(1)

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
