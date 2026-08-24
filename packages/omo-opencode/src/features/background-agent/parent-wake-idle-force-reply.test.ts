import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import { OMO_INTERNAL_NOREPLY_MARKER } from "../../shared"
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

const PROGRESS_WAKE = [
  "<system-reminder>",
  "[BACKGROUND TASK RESULT READY]",
  "**ID:** `task-a`",
  "**1 task still in progress.** You WILL be notified when ALL complete.",
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
  statusProvider?: () => Promise<unknown>
}): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" })
  Object.assign(client.session, {
    messages: async () => ({ data: args.messagesProvider() }),
    status: args.statusProvider ?? (async () => ({ data: args.sessionStatuses })),
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

function firstPartText(call: PromptAsyncCall | undefined): string | undefined {
  const part = call?.body.parts?.[0]
  if (typeof part === "object" && part !== null && "text" in part) {
    return (part as { text?: string }).text
  }
  return undefined
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("parent wake idle force reply", () => {
  test("#given idle parent and partial-completion wake with safe history #then it dispatches a reply-producing wake", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      expect(firstPartText(promptAsyncCalls[0])).not.toContain(OMO_INTERNAL_NOREPLY_MARKER)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getDispatchedParentWakes().get("parent-1")?.shouldReply).toBe(false)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given idle parent and partial wake while recent activity is fresh #then it still forces a reply", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      parentActivityWindowMs: 180_000,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)
    notifier.recordParentSessionActivity("parent-1")

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

  test("#given busy parent and partial wake #then flush defers without dispatch", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => SAFE_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given idle parent and partial wake with blocked tool history #then it stays an admit-only noReply deposit", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given idle parent and partial wake with a fresh user message #then it stays an admit-only noReply deposit", async () => {
    // given
    const now = Date.now()
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => [
        ...SAFE_MESSAGES,
        {
          info: { role: "user", time: { created: now } },
          parts: [{ type: "text", text: "real user follow-up" }],
        },
      ],
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given parent turns active between flush idle-read and gate dispatch #then the gate converts the forced reply into exactly one requeue", async () => {
    // given
    let statusReads = 0
    const statusProvider = async () => {
      statusReads += 1
      const type = statusReads <= 2 ? "idle" : "busy"
      return { data: { "parent-1": { type } } }
    }
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: {},
      messagesProvider: () => SAFE_MESSAGES,
      statusProvider,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
      expect(statusReads).toBeGreaterThanOrEqual(3)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given a forced-reply silent wake was dispatched #when the identical silent wake requeues #then duplicate suppression still holds, and a reply upgrade is not suppressed", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)

      // when
      notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)

      releasePromptAsyncReservation("parent-1", "test:simulate-expired-parent-wake-hold", {
        reservedBy: "background-agent-parent-wake",
      })

      // when
      notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given recent parent activity is fresh and a user message is in progress #when flushing an idle partial-completion wake #then it stays admit-only noReply and retains the pending wake", async () => {
    // given
    const now = Date.now()
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => [
        ...SAFE_MESSAGES,
        {
          info: { role: "user", time: { created: now } },
          parts: [{ type: "text", text: "real user follow-up" }],
        },
      ],
      parentActivityWindowMs: 180_000,
    })
    notifier.queuePendingParentWake("parent-1", PROGRESS_WAKE, { agent: "sisyphus" }, false)
    notifier.recordParentSessionActivity("parent-1")

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      // admit-only deposits drop partial (shouldReply=false) wakes from pending
      // and keep them in the dispatched tracker instead of re-queuing them
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getDispatchedParentWakes().get("parent-1")?.shouldReply).toBe(false)
    } finally {
      notifier.shutdown()
    }
  })
})
