import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import {
  releaseAllPromptAsyncReservationsForTesting,
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

const PARTIAL_WAKE = [
  "<system-reminder>",
  "[BACKGROUND TASK COMPLETED]",
  "",
  "**Completed:**",
  "- `task-a`: task A",
  "",
  'Use `background_output(task_id="<id>")` to retrieve each result.',
  "</system-reminder>",
].join("\n")

const MIDTURN_MESSAGES: SessionMessageStub[] = [
  {
    info: { role: "user", time: { created: 80_000 } },
    parts: [{ type: "text", text: "start work" }],
  },
  {
    info: { role: "assistant", finish: "tool-calls", time: { created: 99_500 } },
    parts: [{ type: "tool", state: { status: "completed" } }],
  },
]

function createNotifier(args: {
  sessionStatuses: Record<string, { type: string }>
  messagesProvider: () => SessionMessageStub[]
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
      parentSessionActivityInProgressWindowMs: 5_000,
    },
  )

  return { notifier, promptAsyncCalls }
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("parent wake mid-turn admission", () => {
  test("#given partial completion wake while parent is mid-turn #then it admits a noReply notification immediately", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => MIDTURN_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", PARTIAL_WAKE, { agent: "sisyphus" }, false)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given reply-required completion wake while parent is mid-turn #then it admits noReply once and retains the reply obligation", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => MIDTURN_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", PARTIAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      notifier.shutdown()
    }
  })

  test("#given failure wake while parent is mid-turn #then it stays deferred until the parent is safe", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => MIDTURN_MESSAGES,
    })
    notifier.queuePendingParentWake(
      "parent-1",
      "<system-reminder>\n[BACKGROUND TASK ERROR]\n</system-reminder>",
      { agent: "sisyphus" },
      true,
    )

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
})
