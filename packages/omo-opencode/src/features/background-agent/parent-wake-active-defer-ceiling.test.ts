import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../../hooks/shared/prompt-async-gate"

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
    time?: { created?: number; completed?: number }
  }
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean; state?: { status?: string } }>
}

const FINAL_WAKE = [
  "<system-reminder>",
  "[BACKGROUND TASK COMPLETED]",
  "[ALL BACKGROUND TASKS COMPLETE]",
  "",
  "**Completed:**",
  "- `task-a`: task A",
  "",
  'Use `background_output(task_id="<id>")` to retrieve each result.',
  "</system-reminder>",
].join("\n")

const BLOCKED_MESSAGES: SessionMessageStub[] = [
  {
    info: { role: "user", time: { created: 80_000 } },
    parts: [{ type: "text", text: "start work" }],
  },
  {
    info: { role: "assistant", finish: "tool-calls", time: { created: 99_500 } },
    parts: [{ type: "tool", state: { status: "running" } }],
  },
]

const SAFE_MESSAGES: SessionMessageStub[] = [
  {
    info: { role: "user", time: { created: 80_000 } },
    parts: [{ type: "text", text: "start work" }],
  },
  {
    info: { role: "assistant", finish: "stop", time: { created: 90_000 } },
    parts: [{ type: "text", text: "delegated to background" }],
  },
]

function createNotifier(args: {
  sessionStatuses: Record<string, { type: string }>
  messagesProvider: () => SessionMessageStub[]
  parentActivityWindowMs?: number
}): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" })
  Object.assign(client.session, {
    messages: async () => ({ data: args.messagesProvider() }),
    status: async () => ({ data: args.sessionStatuses }),
    promptAsync: async (call: PromptAsyncCall) => {
      promptAsyncCalls.push(call)
      return { data: {} }
    },
    abort: async () => ({ data: {} }),
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
      parentSessionActivityInProgressWindowMs: args.parentActivityWindowMs,
    },
  )

  return { notifier, promptAsyncCalls }
}

function queueAgedWake(notifier: ParentWakeNotifier): void {
  notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
  const wake = notifier.getPendingParentWakes().get("parent-1")
  if (!wake) {
    throw new Error("expected pending wake")
  }
  wake.queuedAt = Date.now() - 120_000
}

function releaseParentWakeHold(sessionID: string): void {
  releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("parent wake active defer ceiling", () => {
  test("#given safe history and aged wake while parent is busy #then it dispatches a reply", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => SAFE_MESSAGES,
    })
    queueAgedWake(notifier)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).not.toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given retained noReply wake ages while parent is busy #then it does not force a reply", async () => {
    // given
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const sessionStatuses: Record<string, { type: string }> = { "parent-1": { type: "idle" } }
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses,
      messagesProvider: () => BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()

      // when
      now = 220_000
      sessionStatuses["parent-1"] = { type: "busy" }
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
    }
  })

  test("#given retained noReply wake and fresh activity exceed active ceiling #then it dispatches once safe", async () => {
    // given
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const sessionStatuses: Record<string, { type: string }> = { "parent-1": { type: "idle" } }
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses,
      messagesProvider: () => SAFE_MESSAGES,
      parentActivityWindowMs: 180_000,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    notifier.recordParentSessionActivity("parent-1")

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")
      now = 220_000
      sessionStatuses["parent-1"] = { type: "busy" }
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      notifier.recordParentSessionActivity("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(promptAsyncCalls[1]?.body.noReply).not.toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
    }
  })

  test("#given fresh user message and aged wake while parent is busy #then it admits noReply", async () => {
    // given
    const originalDateNow = Date.now
    const now = 220_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => [
        ...SAFE_MESSAGES,
        {
          info: { role: "user", time: { created: now - 100 } },
          parts: [{ type: "text", text: "real user follow-up" }],
        },
      ],
    })
    queueAgedWake(notifier)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
    }
  })

  test("#given blocked tool history and aged wake while parent is busy #then it admits noReply", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => BLOCKED_MESSAGES,
    })
    queueAgedWake(notifier)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given prompt gate sees blocked tool state after active ceiling #then reply stays queued", async () => {
    // given
    let messageLoads = 0
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => {
        messageLoads += 1
        return messageLoads >= 3 ? BLOCKED_MESSAGES : SAFE_MESSAGES
      },
    })
    queueAgedWake(notifier)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
    } finally {
      notifier.shutdown()
    }
  })
})
