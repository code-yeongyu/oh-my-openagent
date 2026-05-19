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
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean; state?: { status?: string } }>
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

  test("#given stale all-complete wake and gate sees a repaired user tail #when latest assistant is still waiting on tools #then no parent reply is forked", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const promptAsyncCalls: PromptAsyncCall[] = []
    let messageReads = 0
    const waitingToolMessages: SessionMessageStub[] = [
      {
        info: {
          role: "user",
          time: { created: 80_000 },
        },
      },
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 99_500 },
        },
        parts: [{ type: "tool", state: { status: "running" } }],
      },
    ]
    const repairedTailMessages: SessionMessageStub[] = [
      ...waitingToolMessages,
      {
        info: {
          role: "user",
        },
      },
    ]
    const client = {
      session: {
        status: async () => ({ data: { "parent-repaired-tail": { type: "idle" } } }),
        messages: async () => {
          messageReads += 1
          return { data: messageReads === 1 ? waitingToolMessages : repairedTailMessages }
        },
        promptAsync: async (call: PromptAsyncCall) => {
          promptAsyncCalls.push(call)
          return { data: {} }
        },
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
        userMessageInProgressWindowMs: 2_000,
      },
    )
    notifier.queuePendingParentWake(
      "parent-repaired-tail",
      "<system-reminder>\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>",
      { agent: "sisyphus" },
      true,
    )
    const pendingWake = notifier.getPendingParentWakes().get("parent-repaired-tail")
    expect(pendingWake).toBeDefined()
    if (!pendingWake) {
      throw new Error("Missing pending parent wake")
    }
    pendingWake.toolCallDeferralStartedAt = 90_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-repaired-tail")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-repaired-tail")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given internal user tail follows a waiting assistant #when flushing pending wake #then parent wake remains deferred", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "user",
            time: { created: 80_000 },
          },
          parts: [{ type: "text", text: "run work" }],
        },
        {
          info: {
            role: "assistant",
            finish: "tool-calls",
            time: { created: 99_000 },
          },
          parts: [{ type: "tool_use", state: { status: "running" } }],
        },
        {
          info: {
            role: "user",
            time: { created: 99_500 },
          },
          parts: [{ type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" }],
        },
      ],
    })
    notifier.queuePendingParentWake(
      "parent-internal-tail-tools",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-internal-tail-tools")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-internal-tail-tools")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given only an internal user tail is fresh #when flushing pending wake #then user race guard does not defer", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: 90_000 },
          },
        },
        {
          info: {
            role: "user",
            time: { created: 99_900 },
          },
          parts: [{ type: "text", text: "wake", synthetic: true }],
        },
      ],
    })
    notifier.queuePendingParentWake(
      "parent-internal-tail-user-race",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-internal-tail-user-race")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has("parent-internal-tail-user-race")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given mixed real user tail is fresh #when flushing pending wake #then user race guard still defers", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionMessages: [
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: 90_000 },
          },
        },
        {
          info: {
            role: "user",
            time: { created: 99_900 },
          },
          parts: [
            { type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" },
            { type: "text", text: "real user follow-up" },
          ],
        },
      ],
    })
    notifier.queuePendingParentWake(
      "parent-mixed-user-race",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-mixed-user-race")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-mixed-user-race")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given accepted wake message predates promptAsync return #when late failure is requeued #then accepted dispatch is not duplicated", async () => {
    // given
    const originalDateNow = Date.now
    let now = 1_000
    Date.now = () => now
    const sessionMessages: SessionMessageStub[] = [
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: 500 },
        },
      },
    ]
    const client = {
      session: {
        status: async () => ({ data: { "parent-accepted-before-return": { type: "idle" } } }),
        messages: async () => ({ data: sessionMessages }),
        promptAsync: async () => {
          sessionMessages.push({
            info: {
              role: "user",
              time: { created: 1_100 },
            },
            parts: [{ type: "text", text: "task complete\n<!-- OMO_INTERNAL_INITIATOR -->" }],
          })
          now = 2_000
          return { data: {} }
        },
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
    notifier.queuePendingParentWake(
      "parent-accepted-before-return",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-accepted-before-return")
      const requeued = await notifier.requeueDispatchedParentWake(
        "parent-accepted-before-return",
        "late session.error",
      )

      // then
      expect(requeued).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-accepted-before-return")).toBe(false)
      expect(notifier.getDispatchedParentWakes().has("parent-accepted-before-return")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given promptAsync stores the wake then reports EOF #when the gate hold expires #then parent wake is not requeued into a duplicate prompt", async () => {
    // given
    const originalDateNow = Date.now
    let now = 1_000
    Date.now = () => now
    const sessionMessages: SessionMessageStub[] = [
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: 500 },
        },
      },
    ]
    const promptAsyncCalls: PromptAsyncCall[] = []
    const client = {
      session: {
        status: async () => ({ data: { "parent-eof-before-return": { type: "idle" } } }),
        messages: async () => ({ data: sessionMessages }),
        promptAsync: async (call: PromptAsyncCall) => {
          promptAsyncCalls.push(call)
          sessionMessages.push({
            info: {
              role: "user",
              time: { created: 1_100 },
            },
            parts: [{ type: "text", text: "task complete\n<!-- OMO_INTERNAL_INITIATOR -->" }],
          })
          now = 2_000
          throw new Error("JSON Parse error: Unexpected EOF")
        },
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
    notifier.queuePendingParentWake(
      "parent-eof-before-return",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-eof-before-return")
      const released = releasePromptAsyncReservation("parent-eof-before-return", "test:simulate-expired-hold", {
        reservedBy: "background-agent-parent-wake",
      })
      await notifier.flushPendingParentWake("parent-eof-before-return")

      // then
      expect(released).toBe(true)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has("parent-eof-before-return")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given accepted wake produces sdk tool-call output #when late failure is requeued #then accepted dispatch is not duplicated", async () => {
    // given
    const originalDateNow = Date.now
    let now = 1_000
    Date.now = () => now
    const sessionMessages: SessionMessageStub[] = [
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: 500 },
        },
      },
    ]
    const client = {
      session: {
        status: async () => ({ data: { "parent-tool-call-output": { type: "idle" } } }),
        messages: async () => ({ data: sessionMessages }),
        promptAsync: async () => {
          sessionMessages.push({
            info: {
              role: "assistant",
              time: { created: 1_100 },
            },
            parts: [{ type: "tool-call" }],
          })
          now = 2_000
          return { data: {} }
        },
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
    notifier.queuePendingParentWake(
      "parent-tool-call-output",
      "task complete",
      { agent: "sisyphus" },
      true,
    )

    try {
      // when
      await notifier.flushPendingParentWake("parent-tool-call-output")
      const requeued = await notifier.requeueDispatchedParentWake(
        "parent-tool-call-output",
        "late session.error",
      )

      // then
      expect(requeued).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-tool-call-output")).toBe(false)
      expect(notifier.getDispatchedParentWakes().has("parent-tool-call-output")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
