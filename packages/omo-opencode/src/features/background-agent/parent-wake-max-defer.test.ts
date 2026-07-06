import { afterEach, describe, expect, test } from "bun:test"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import type { PendingParentWake } from "./parent-wake-dedupe"
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
    time?: { created?: number; completed?: number }
    error?: { name?: string }
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

// Assistant-terminated history so hasRecentActivity / history-deferral do not
// independently block the flush — the only blocker is the busy session status.
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

// Latest message is a fresh user prompt (created at "now") — triggers
// isUserMessageInProgress so the max-defer force path must fall back to
// retained noReply admission instead of a reply-producing dispatch (#4120).
const USER_MESSAGE_IN_PROGRESS: SessionMessageStub[] = [
  {
    info: { role: "assistant", finish: "stop", time: { created: 90_000 } },
    parts: [{ type: "text", text: "delegated to background" }],
  },
  {
    info: { role: "user", time: { created: 100_060 } },
    parts: [{ type: "text", text: "are you done yet?" }],
  },
]

// Latest assistant turn has an outstanding (running) tool call — triggers
// latestAssistantTurnBlocksInternalPrompt so shouldDeferParentWakeForSessionHistory
// returns defer:true. The max-defer force path must NOT forceReplyDispatch into
// this unsafe turn; it admits noReply retained instead.
const TOOL_CALL_IN_PROGRESS: SessionMessageStub[] = [
  {
    info: {
      role: "assistant",
      finish: "tool-calls",
      time: { created: 90_000 },
    },
    parts: [
      { type: "text", text: "let me check" },
      { type: "tool", state: { status: "running" } },
    ],
  },
]

function createNotifier(args: {
  sessionStatuses?: Record<string, { type: string }>
  messagesProvider: () => SessionMessageStub[]
  maxDeferMs?: number
}): {
  notifier: ParentWakeNotifier
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      messages: async () => ({ data: args.messagesProvider() }),
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
      userMessageInProgressWindowMs: 2_000,
      ...(args.maxDeferMs !== undefined ? { maxDeferMs: args.maxDeferMs } : {}),
    },
  )

  return { notifier, promptAsyncCalls }
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("parent wake max-defer force-flush (#5864)", () => {
  test("#given parent stays busy and active past max-defer #then force-flushes a reply dispatch and clears the pending wake", async () => {
    // given: parent permanently busy, safe history, small max-defer ceiling
    const originalDateNow = Date.now
    const queueTime = 100_000
    Date.now = () => queueTime
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => SAFE_MESSAGES,
      maxDeferMs: 50,
    })

    try {
      // when: queue a reply-required all-complete wake, mark recent activity
      // (simulating continuous tool calls), then advance the clock past the
      // max-defer ceiling and flush.
      notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      notifier.recordParentSessionActivity("parent-1")
      Date.now = () => queueTime + 60 // 60ms > 50ms ceiling
      await notifier.flushPendingParentWake("parent-1")

      // then: a reply-producing dispatch happened (the load-bearing assertion —
      // without the fix the sessionActive branch returns early and no dispatch
      // occurs) and the pending entry was cleared, not retained.
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given max-defer exceeded but user message just arrived #then admits noReply retained and keeps the wake queued (#4120 guard)", async () => {
    // given: 50ms max-defer ceiling; clock starts at 100_000. A reply-required
    // wake is queued at 100_000 and the parent stays busy/active. After the
    // ceiling elapses the user sends a fresh prompt into the parent session
    // (latest message created at "now"), so isUserMessageInProgress() is true.
    // The max-defer force path must NOT force a reply-producing dispatch
    // (that would race the user's prompt and can crash the sidecar on
    // Electron/macOS, #4120). Instead it admits the wake as retained noReply
    // and keeps the pending entry queued for the user's turn to consume.
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => USER_MESSAGE_IN_PROGRESS,
      maxDeferMs: 50,
    })

    try {
      // when: queue a reply-required wake, mark recent activity, advance the
      // clock past the ceiling (60ms > 50ms), and flush. The messages provider
      // returns a fresh user message created at 100_060 (== now), so the
      // isUserMessageInProgress guard fires inside the max-defer force path.
      notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      notifier.recordParentSessionActivity("parent-1")
      Date.now = () => 100_060
      await notifier.flushPendingParentWake("parent-1")

      // then: a noReply dispatch happened (admit-only, not reply-producing)
      // and the pending wake is retained for the user's turn to consume.
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given max-defer exceeded but assistant turn has outstanding tool call #then admits noReply retained and keeps the wake queued (history safety)", async () => {
    // given: 50ms max-defer ceiling; clock starts at 100_000. A reply-required
    // wake is queued at 100_000 and the parent stays busy/active. After the
    // ceiling elapses, the parent's latest assistant turn has finish:"tool-calls"
    // with a running tool part — shouldDeferParentWakeForSessionHistory returns
    // defer:true. The max-defer force path must NOT forceReplyDispatch into
    // this unsafe turn (would fork a concurrent assistant turn); it admits
    // noReply retained instead, and the idle/consumption machinery resumes
    // when the tool settles.
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => TOOL_CALL_IN_PROGRESS,
      maxDeferMs: 50,
    })

    try {
      // when: queue a reply-required wake, mark recent activity, advance the
      // clock past the ceiling (60ms > 50ms), and flush. The messages provider
      // returns an assistant turn with a running tool call, so the history
      // deferral guard fires inside the max-defer force path.
      notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      notifier.recordParentSessionActivity("parent-1")
      Date.now = () => 100_060
      await notifier.flushPendingParentWake("parent-1")

      // then: a noReply dispatch happened (admit-only, not reply-producing)
      // and the pending wake is retained for the turn to settle.
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given max-defer ceiling not yet elapsed #then does not force-flush (regression guard)", async () => {
    // given: large max-defer ceiling so the ceiling has not elapsed
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => SAFE_MESSAGES,
      maxDeferMs: 50_000,
    })

    try {
      // when: queue a reply wake, mark recent activity, flush immediately
      notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      notifier.recordParentSessionActivity("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: still deferred — no dispatch, pending wake retained. Guards
      // against an over-eager force-flush that would interleave on every flush.
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given maxDeferMs undefined #then preserves legacy indefinite-defer behavior", async () => {
    // given: notifier constructed WITHOUT maxDeferMs (default), parent busy
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => SAFE_MESSAGES,
    })

    try {
      // when: queue a reply wake, mark recent activity, advance clock 10s, flush
      notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      notifier.recordParentSessionActivity("parent-1")
      Date.now = () => 110_000
      await notifier.flushPendingParentWake("parent-1")

      // then: no dispatch, pending wake still present — the default is a no-op
      // and no existing caller's behavior changes.
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("parent wake queuedAt preservation across requeue merges (#5864)", () => {
  test("#given existing wake with newer queuedAt #when older wake requeues into it #then keeps the oldest queuedAt", () => {
    // given: an existing pending wake queued at T=200 (newer)
    const originalDateNow = Date.now
    Date.now = () => 200_000
    const queue = new ParentWakePendingQueue({
      pendingRetryMs: 1_000,
      enqueueNotificationForParent: async (_sessionID, operation) => {
        await operation()
      },
    })
    try {
      queue.queueWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
      expect(queue.getWake("parent-1")?.queuedAt).toBe(200_000)

      // when: an older wake (queuedAt=100) is requeued into the existing entry.
      // Build the requeued wake as an independent literal — do NOT mutate the
      // queue's existing wake, otherwise the old ??= bug would pass too.
      const existing = queue.getWake("parent-1")!
      const requeuedWake: PendingParentWake = {
        ...existing,
        queuedAt: 100_000,
      }
      Date.now = () => 210_000
      queue.requeueWake("parent-1", requeuedWake)

      // then: the merged wake keeps the oldest (minimum) queuedAt, not the
      // newer one — so the max-defer clock still measures time-since-first-queue.
      // With the old ??= bug, the existing 200_000 would be kept (not overwritten).
      expect(queue.getWake("parent-1")?.queuedAt).toBe(100_000)
    } finally {
      Date.now = originalDateNow
      queue.shutdown()
    }
  })

  test("#given existing wake with older queuedAt #when newer wake requeues into it #then keeps the oldest queuedAt", () => {
    // given: an existing pending wake queued at T=100 (older)
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const queue = new ParentWakePendingQueue({
      pendingRetryMs: 1_000,
      enqueueNotificationForParent: async (_sessionID, operation) => {
        await operation()
      },
    })
    queue.queueWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    expect(queue.getWake("parent-1")?.queuedAt).toBe(100_000)

    // when: a newer wake (queuedAt=200) is requeued into the existing entry
    const existing = queue.getWake("parent-1")!
    const requeuedWake = {
      ...existing,
      queuedAt: 200_000,
    }
    Date.now = () => 210_000
    queue.requeueWake("parent-1", requeuedWake)

    // then: the merged wake keeps the older (minimum) queuedAt
    expect(queue.getWake("parent-1")?.queuedAt).toBe(100_000)

    Date.now = originalDateNow
    queue.shutdown()
  })
})
