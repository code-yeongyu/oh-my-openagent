import { afterEach, describe, expect, test } from "bun:test"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import type { SessionExistenceStatus } from "./session-existence"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../../hooks/shared/prompt-async-gate"
import { schedulePromptQueueDrain } from "../../shared/prompt-async-gate/queue"
import { deletePromptReservation, setPromptReservation } from "../../shared/prompt-async-gate/reservations"

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

// An assistant turn that is still busy (running tool) so history-based and
// activity-based defers keep firing while the parent stays unsafe.
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

// A settled assistant turn whose only output predates the wake, so the parent
// is "safe" but no assistant output exists after a dispatch.
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
  sessionStatuses?: Record<string, { type: string }>
  messagesProvider: () => SessionMessageStub[]
  promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>
  checkParentSessionExistence?: (sessionID: string) => Promise<SessionExistenceStatus>
  maxDeferMs?: number
  maxWindowRefreshes?: number
  failureRequeueWindowMs?: number
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
        return (await args.promptAsyncImpl?.(call)) ?? { data: {} }
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
      ...(args.checkParentSessionExistence
        ? { checkParentSessionExistence: args.checkParentSessionExistence }
        : {}),
    },
    {
      pendingRetryMs: 1_000,
      acceptedMessageSkewMs: 5_000,
      toolCallDeferMaxMs: 5_000,
      failureRequeueWindowMs: args.failureRequeueWindowMs ?? 5_000,
      userMessageInProgressWindowMs: 2_000,
      ...(args.maxDeferMs !== undefined ? { maxDeferMs: args.maxDeferMs } : {}),
      ...(args.maxWindowRefreshes !== undefined ? { maxWindowRefreshes: args.maxWindowRefreshes } : {}),
    },
  )

  return { notifier, promptAsyncCalls }
}

function releaseParentWakeHold(sessionID: string): void {
  releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("BUG B1: unbounded parent-wake deferral starvation (upstream #5089)", () => {
  test("#given a perpetually busy parent #when the wake is deferred past the max #then it is force-dispatched as a noReply admission", async () => {
    // given: the parent session is continuously active (ultrawork / todo loop),
    // so the active-session defer path reschedules at 1s forever.
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      messagesProvider: () => BLOCKED_MESSAGES,
      maxDeferMs: 5_000,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: the first flush only defers because the parent is active
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().get("parent-1")?.firstDeferredAt).toBe(100_000)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)

      // when: the deferral budget is exceeded while the parent stays busy
      now = 100_000 + 5_001
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the wake is force-dispatched as a noReply admission despite the
      // parent still being active (content lands at the next turn boundary)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(JSON.stringify(promptAsyncCalls[0]?.body.parts)).toContain("ALL BACKGROUND TASKS COMPLETE")
      // the reply-required wake is retained for a later reply-producing resume
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("BUG B2: retained reply-wake never re-flushed (upstream #5189)", () => {
  test("#given a reply-required wake admitted as noReply while the parent is busy #then a re-flush stays scheduled and the wake force-delivers even if the parent never goes safe", async () => {
    // given: the parent keeps a tool turn running, so every flush defers the
    // retained reply wake (recent-activity / history defers).
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => BLOCKED_MESSAGES,
      maxDeferMs: 5_000,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: the wake is admitted as noReply and retained
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      // then: it is retained AND a re-flush timer is scheduled (never abandoned)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)

      // when: the parent stays unsafe across another flush
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")
      // then: still retained, still re-flush-scheduled, no duplicate admission
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)

      // when: the parent NEVER goes safe but the deferral budget is exceeded
      now = 100_000 + 5_001
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: B1 force-path re-delivers the retained completion as noReply
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(true)
      expect(JSON.stringify(promptAsyncCalls[1]?.body.parts)).toContain("ALL BACKGROUND TASKS COMPLETE")
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a retained reply wake #when the parent finally goes safe #then it dispatches with a reply", async () => {
    // given
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    let blocked = true
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => (blocked ? BLOCKED_MESSAGES : SAFE_MESSAGES),
      maxDeferMs: 5_000,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: admitted as noReply while busy, then the parent goes safe
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)

      blocked = false
      now = 110_000
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: a reply-producing resume fires exactly once and the wake clears
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("BUG B3: dispatched-wake silent loss requeues after repeated empty windows", () => {
  test("#given a dispatched wake with no assistant output #when the failure window refreshes maxWindowRefreshes times #then the wake is requeued into the pending queue", async () => {
    // given: the parent is safe so the wake dispatches normally, but no
    // assistant/tool output ever appears after the dispatch (silent drop).
    const sessionStatuses: Record<string, { type: string }> = { "parent-1": { type: "idle" } }
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses,
      messagesProvider: () => SAFE_MESSAGES,
      failureRequeueWindowMs: 5,
      maxWindowRefreshes: 3,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: the wake dispatches and is tracked
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().has("parent-1")).toBe(true)
      // keep the parent busy from now so any re-flush after requeue just defers
      sessionStatuses["parent-1"] = { type: "busy" }

      // then: after the failure window refreshes 3x (~15ms) with no output, the
      // wake is requeued into the pending queue and the dispatched record cleared
      await waitUntil(() => notifier.getPendingParentWakes().has("parent-1"), 600)
      expect(notifier.getPendingParentWakes().get("parent-1")?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getDispatchedParentWakes().has("parent-1")).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("BUG B4: deleted parent session drops the wake instead of retrying forever", () => {
  test("#given the parent session is missing #when a dispatch fails #then the wake is dropped with no reschedule", async () => {
    // given: every dispatch throws and the parent session no longer exists
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      promptAsyncImpl: async () => {
        throw new Error("session not found")
      },
      checkParentSessionExistence: async () => "missing",
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then: the dispatch was attempted, then the wake is dropped permanently
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given the parent existence is unknown #when a dispatch fails #then the wake is requeued and retried", async () => {
    // given: dispatch throws but existence cannot be confirmed as missing
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      promptAsyncImpl: async () => {
        throw new Error("transient network error")
      },
      checkParentSessionExistence: async () => "unknown",
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then: the wake stays pending and a retry flush is scheduled
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get("parent-1")?.notifications).toEqual([FINAL_WAKE])
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("force-dispatch that QUEUES at the gate is not tracked as dispatched", () => {
  test("#given an active reservation on the parent #when a wake exceeds max deferral and force-dispatch queues at the gate #then it is not tracked dispatched, starts no B3 window, and the gate delivers it exactly once", async () => {
    // given: a foreign reservation holds the gate, so an enqueue force-dispatch
    // returns "queued" (blocked) rather than "dispatched".
    const originalDateNow = Date.now
    const now = 100_000
    Date.now = () => now
    let delivered = false
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () =>
        delivered
          ? [
              ...SAFE_MESSAGES,
              {
                info: { role: "assistant", finish: "stop", time: { created: 100_500 } },
                parts: [{ type: "text", text: "acknowledged background completion" }],
              },
            ]
          : SAFE_MESSAGES,
      maxDeferMs: 5_000,
    })
    setPromptReservation("parent-1", {
      source: "some-other-live-turn",
      dedupeKey: "foreign-reservation-key",
      reservedAt: now,
      token: Symbol("foreign"),
      expiresAt: now + 60_000,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const queuedWake = notifier.getPendingParentWakes().get("parent-1")
    if (!queuedWake) throw new Error("missing wake")
    queuedWake.firstDeferredAt = now - 5_001

    try {
      // when: the force dispatch runs but the gate queues it behind the reservation
      await notifier.flushPendingParentWake("parent-1")

      // then: nothing was actually dispatched to the parent yet…
      expect(promptAsyncCalls).toHaveLength(0)
      // …the wake is NOT tracked as dispatched (no premature B3 state)…
      expect(notifier.getDispatchedParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getDispatchedParentWakeTimers().has("parent-1")).toBe(false)
      // …and the pending wake is retained and marked force-queued
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeUndefined()

      // when: another flush runs while still queued at the gate
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")
      // then: no re-force, no second dispatch, still queued (no duplicate entry)
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getDispatchedParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()

      // when: the reservation clears and the gate drains the queued entry
      deletePromptReservation("parent-1")
      schedulePromptQueueDrain("parent-1", 0)
      await waitUntil(() => promptAsyncCalls.length === 1, 600)

      // then: the gate delivered the queued entry exactly once as a noReply admission
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)

      // when: the parent shows output after the deposit and the wake re-flushes
      delivered = true
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the wake is dropped exactly once, with no duplicate dispatch
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getDispatchedParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("force-queued lifecycle is gate-truthful", () => {
  const SECOND_WAKE = [
    "<system-reminder>",
    "[BACKGROUND TASK COMPLETED]",
    "[ALL BACKGROUND TASKS COMPLETE]",
    "",
    "**Completed:**",
    "- `task-z`: task Z",
    "</system-reminder>",
  ].join("\n")

  function reserveForeignGate(sessionID: string, now: number): void {
    setPromptReservation(sessionID, {
      source: "some-other-live-turn",
      dedupeKey: "foreign-reservation-key",
      reservedAt: now,
      token: Symbol("foreign"),
      expiresAt: now + 60_000,
    })
  }

  test("#given a force-queued wake (HOLE 1) #when assistant output appears after forcedQueuedAt but before gate delivery #then the wake is NOT falsely consumed", async () => {
    // given
    const originalDateNow = Date.now
    const now = 100_000
    Date.now = () => now
    let outputAppeared = false
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () =>
        outputAppeared
          ? [
              ...SAFE_MESSAGES,
              {
                info: { role: "assistant", finish: "stop", time: { created: 100_500 } },
                parts: [{ type: "text", text: "unrelated parent work" }],
              },
            ]
          : SAFE_MESSAGES,
      maxDeferMs: 5_000,
    })
    reserveForeignGate("parent-1", now)
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = notifier.getPendingParentWakes().get("parent-1")
    if (!wake) throw new Error("missing wake")
    wake.firstDeferredAt = now - 5_001

    try {
      await notifier.flushPendingParentWake("parent-1")
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeUndefined()

      // when: unrelated assistant output appears AFTER forcedQueuedAt, while the
      // queued entry is still sitting undelivered behind the reservation
      outputAppeared = true
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the wake is NOT consumed/dropped (forcedQueuedAt is not an admission)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()
      expect(promptAsyncCalls).toHaveLength(0)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a force-queued wake that the gate delivers (HOLE 2) #when no assistant output follows #then the retained reply wake resumes with a reply (no deadlock)", async () => {
    // given
    const originalDateNow = Date.now
    const now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      maxDeferMs: 5_000,
    })
    reserveForeignGate("parent-1", now)
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = notifier.getPendingParentWakes().get("parent-1")
    if (!wake) throw new Error("missing wake")
    wake.firstDeferredAt = now - 5_001

    try {
      await notifier.flushPendingParentWake("parent-1")
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()

      // when: the reservation clears and the gate delivers the queued noReply entry
      deletePromptReservation("parent-1")
      schedulePromptQueueDrain("parent-1", 0)
      await waitUntil(() => promptAsyncCalls.length === 1, 600)

      // then: real admission is recorded only now, and the force marker is cleared
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeUndefined()
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()

      // when: no assistant output follows the deposit and the parent is safe
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the retained reply wake resumes with a reply instead of deadlocking
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a force-queued wake (HOLE 3) #when a new notification merges in #then the force marker clears and the new content dispatches", async () => {
    // given
    const originalDateNow = Date.now
    const now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      maxDeferMs: 5_000,
    })
    reserveForeignGate("parent-1", now)
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = notifier.getPendingParentWakes().get("parent-1")
    if (!wake) throw new Error("missing wake")
    wake.firstDeferredAt = now - 5_001

    try {
      await notifier.flushPendingParentWake("parent-1")
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()

      // when: a genuinely new notification merges into the pending wake
      notifier.queuePendingParentWake("parent-1", SECOND_WAKE, { agent: "sisyphus" }, true)

      // then: the stale force-queued marker is cleared so new content is not blocked
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeUndefined()
      expect(JSON.stringify(notifier.getPendingParentWakes().get("parent-1")?.notifications)).toContain("task-z")

      // when: the stale gate entry drops (residual old-entry delivery is
      // tolerated) and the gate is free, the unblocked wake force-dispatches the
      // new merged content. Clearing gate state simulates the old queued entry
      // expiring/being superseded.
      releaseAllPromptAsyncReservationsForTesting()
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the new content (task-z) reaches a dispatch — it was not blocked
      expect(promptAsyncCalls.some((call) => JSON.stringify(call.body.parts).includes("task-z"))).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})

describe("force-queue callbacks are identity-bound", () => {
  const SECOND_WAKE = [
    "<system-reminder>",
    "[BACKGROUND TASK COMPLETED]",
    "[ALL BACKGROUND TASKS COMPLETE]",
    "",
    "**Completed:**",
    "- `task-z`: task Z",
    "</system-reminder>",
  ].join("\n")

  function reserveForeignGate(sessionID: string, now: number): void {
    setPromptReservation(sessionID, {
      source: "some-other-live-turn",
      dedupeKey: "foreign-reservation-key",
      reservedAt: now,
      token: Symbol("foreign"),
      expiresAt: now + 60_000,
    })
  }

  test("#given a force-queued wake (ITEM 1) #when a new notification rotates the token before the stale gate entry dispatches #then the stale onDispatched does NOT admit and the new content still dispatches", async () => {
    // given: wake A is force-queued (token T1) behind a reservation
    const originalDateNow = Date.now
    const now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      maxDeferMs: 5_000,
    })
    reserveForeignGate("parent-1", now)
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = notifier.getPendingParentWakes().get("parent-1")
    if (!wake) throw new Error("missing wake")
    wake.firstDeferredAt = now - 5_001

    try {
      await notifier.flushPendingParentWake("parent-1")
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeDefined()
      const tokenBeforeMerge = notifier.getPendingParentWakes().get("parent-1")?.forceQueueToken
      expect(tokenBeforeMerge).toBeDefined()

      // when: a new notification B merges, rotating (clearing) the token
      notifier.queuePendingParentWake("parent-1", SECOND_WAKE, { agent: "sisyphus" }, true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeUndefined()
      expect(notifier.getPendingParentWakes().get("parent-1")?.forceQueueToken).toBeUndefined()

      // when: the STALE entry A finally dispatches (its onDispatched carries T1)
      deletePromptReservation("parent-1")
      schedulePromptQueueDrain("parent-1", 0)
      await waitUntil(() => promptAsyncCalls.length === 1, 600)

      // then: the stale callback is a no-op — the A+B wake is NOT marked admitted
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeUndefined()
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(true)

      // when: the gate is cleared and the unblocked wake force-dispatches the new content
      releaseAllPromptAsyncReservationsForTesting()
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the new content (task-z) is dispatched
      expect(promptAsyncCalls.some((call) => JSON.stringify(call.body.parts).includes("task-z"))).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an identical dispatch is already in flight (ITEM 2) #when the force dispatch coalesces (queued without a real entry) #then forcedQueuedAt is NOT set", async () => {
    // given: a first force dispatch actually dispatches and records a recent
    // dispatch + a same-dedupe post-dispatch hold (no foreign reservation).
    const originalDateNow = Date.now
    const now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => SAFE_MESSAGES,
      maxDeferMs: 5_000,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = notifier.getPendingParentWakes().get("parent-1")
    if (!wake) throw new Error("missing wake")
    wake.firstDeferredAt = now - 5_001

    try {
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeUndefined()

      // when: the budget is exhausted again and a second force dispatch fires
      // while the identical dispatch is still in flight -> coalesced "queued"
      const stillPending = notifier.getPendingParentWakes().get("parent-1")
      if (!stillPending) throw new Error("missing retained wake")
      stillPending.firstDeferredAt = now - 5_001
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the coalesced queued result did NOT mark force-queued (which would
      // never resolve), and no duplicate dispatch was issued
      expect(notifier.getPendingParentWakes().get("parent-1")?.forcedQueuedAt).toBeUndefined()
      expect(promptAsyncCalls).toHaveLength(1)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
