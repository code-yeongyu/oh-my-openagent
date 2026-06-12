import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { ParentWakeNotifier } from "./parent-wake-notifier"
import { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import type { BackgroundTask } from "./types"
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

const SECOND_FINAL_WAKE = [
  "<system-reminder>",
  "[BACKGROUND TASK COMPLETED]",
  "[ALL BACKGROUND TASKS COMPLETE]",
  "",
  "**Completed:**",
  "- `task-b`: task B",
  "",
  'Use `background_output(task_id="<id>")` to retrieve each result.',
  "</system-reminder>",
].join("\n")

const FAILURE_WAKE = [
  "<system-reminder>",
  "[BACKGROUND TASK ERROR]",
  "**ID:** `task-a`",
  "**Description:** task A",
  "**Duration:** 4s",
  "**Error:** boom",
  "",
  "**1 task still in progress.** You WILL be notified when ALL complete.",
  "**ACTION REQUIRED:** This task failed. Check the error and decide whether to retry, cancel remaining tasks, or continue.",
  "",
  'Use `background_output(task_id="task-a")` to retrieve this result when ready.',
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
  sessionStatuses?: Record<string, { type: string }>
  messagesProvider: () => SessionMessageStub[]
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
    },
  )

  return { notifier, promptAsyncCalls }
}

function releaseParentWakeHold(sessionID: string): void {
  releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("parent wake noReply admission liveness (issues #4874/#5086)", () => {
  test("#given all-complete wake admitted as noReply during history deferral #then reply liveness is retained and resumes once safe", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    let blocked = true
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => (blocked ? BLOCKED_MESSAGES : SAFE_MESSAGES),
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: flush while the latest assistant turn still blocks internal prompts
      await notifier.flushPendingParentWake("parent-1")

      // then: the reminder is admitted as noReply for active-turn visibility…
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      // …but the reply-required wake is retained, with a retry flush scheduled
      const retainedWake = notifier.getPendingParentWakes().get("parent-1")
      expect(retainedWake?.shouldReply).toBe(true)
      expect(retainedWake?.noReplyAdmittedAt).toBeDefined()
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)

      // when: another flush runs while the parent is still unsafe
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: no duplicate noReply admission is sent and the wake stays retained
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)

      // when: the parent becomes safe and the gate hold expires
      blocked = false
      releaseParentWakeHold("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: exactly one reply-producing resume is dispatched
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(JSON.stringify(promptAsyncCalls[1]?.body.parts)).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given noReply admission of a reply-required wake #then the dispatched tracker does not claim reply coverage", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then: the admission must not phantom-satisfy a later reply-required flush
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getDispatchedParentWakes().get("parent-1")?.shouldReply).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given failure wake while parent is unsafe #then it stays pending without admission and resumes with a reply once safe", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    let blocked = true
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => (blocked ? BLOCKED_MESSAGES : SAFE_MESSAGES),
    })
    notifier.queuePendingParentWake("parent-1", FAILURE_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: flush while the latest assistant turn still blocks internal prompts
      await notifier.flushPendingParentWake("parent-1")

      // then: failure wakes are deferred, never consumed as noReply
      expect(promptAsyncCalls).toHaveLength(0)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)

      // when: the parent becomes safe
      blocked = false
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given user message in progress when all-complete wake flushes #then noReply admission retains reply liveness", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 100_000
    let userMessageFresh = true
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => [
        ...SAFE_MESSAGES,
        {
          info: { role: "user", time: { created: userMessageFresh ? 99_900 : 80_500 } },
          parts: [{ type: "text", text: "real user follow-up" }],
        },
      ],
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)

      // when: the user turn settles and the gate hold expires
      userMessageFresh = false
      releaseParentWakeHold("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given a retained admitted wake #when a new final notification merges in #then the admission marker resets for re-admission", () => {
    // given
    const queue = new ParentWakePendingQueue({
      pendingRetryMs: 1_000,
      enqueueNotificationForParent: async (_sessionID, operation) => {
        await operation()
      },
    })
    queue.queueWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = queue.getWake("parent-1")
    expect(wake).toBeDefined()
    if (!wake) throw new Error("missing wake")
    wake.noReplyAdmittedAt = 100_000

    // when: the identical notification merges again
    queue.queueWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    // then: nothing changed, the admission marker survives
    expect(queue.getWake("parent-1")?.noReplyAdmittedAt).toBe(100_000)

    // when: a genuinely new final notification merges in
    queue.queueWake("parent-1", SECOND_FINAL_WAKE, { agent: "sisyphus" }, true)

    // then: the marker resets so the new content can be admitted for visibility
    expect(queue.getWake("parent-1")?.noReplyAdmittedAt).toBeUndefined()

    queue.shutdown()
  })
})

describe("parent wake admitted-consumption drop (duplicate ALL-COMPLETE regression)", () => {
  test("#given admitted wake consumed by live turn output #when stale tool-call deferral would force a resume #then no duplicate reply dispatch and the wake is dropped", async () => {
    // given: reproduce ses_14a3ab27bffe — admit-only deposit at T, parent's live
    // turn keeps producing output after the admission, then the stale tool-call
    // hatch fires while every busy signal is blind.
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    let consumed = false
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () =>
        consumed
          ? [
              ...BLOCKED_MESSAGES,
              {
                info: { role: "assistant", finish: "tool-calls", time: { created: 101_000 } },
                parts: [
                  { type: "text", text: "retrieving background results" },
                  { type: "tool", state: { status: "running" } },
                ],
              },
            ]
          : BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: flush admits the wake as noReply during history deferral
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()

      // when: the live turn consumes the deposit (assistant output created after
      // admission) and the tool-call deferral goes stale
      consumed = true
      now = 110_000
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the retained wake is dropped instead of re-dispatched as a
      // reply prompt (which forked a concurrent assistant chain in production)
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
      expect(notifier.getDispatchedParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given admitted wake while the tool-blocked turn is still mid-flight #when the tool-call deferral goes stale #then no reply dispatch forks the turn", async () => {
    // given: reproduce ses_149e6ecb2ffe — admit-only deposit during a silent
    // long-running tool (sleep), no post-admission output yet
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: flush admits the wake as noReply during history deferral
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)

      // when: the deferral goes stale while the same tool turn is still running
      now = 110_000
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the admitted wake keeps waiting instead of forking a reply turn
      expect(promptAsyncCalls).toHaveLength(1)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakeTimers().has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given un-admitted wake with a stale tool-call deferral #then it is admitted as noReply instead of a reply dispatch", async () => {
    // given: the first admission attempt never landed (gate hold), the
    // deferral aged out while the tool turn is still mid-flight
    const originalDateNow = Date.now
    Date.now = () => 110_000
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () => BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)
    const wake = notifier.getPendingParentWakes().get("parent-1")
    expect(wake).toBeDefined()
    if (!wake) throw new Error("missing wake")
    wake.toolCallDeferralStartedAt = 100_000

    try {
      // when
      await notifier.flushPendingParentWake("parent-1")

      // then: content is deposited without forking, reply liveness retained
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)
      expect(notifier.getPendingParentWakes().get("parent-1")?.noReplyAdmittedAt).toBeDefined()
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given retained wake whose own deposit is the last message #then the resume is not deadlocked by the deposit", async () => {
    // given: the admit-only deposit landed after the turn ended, so the session
    // history now ends with the wake's own synthetic user message and nothing
    // will ever answer it.
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    let deposited = false
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () =>
        deposited
          ? [
              ...SAFE_MESSAGES,
              {
                info: { role: "user", time: { created: 100_100 } },
                parts: [
                  {
                    type: "text",
                    text: `${FINAL_WAKE}\n\n<!-- OMO_INTERNAL_INITIATOR -->`,
                    synthetic: true,
                  },
                ],
              },
            ]
          : BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: flush admits the wake as noReply during history deferral
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)

      // when: the deposit is now the trailing message and the parent is idle
      deposited = true
      now = 110_000
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: the reply-producing resume dispatches instead of deferring forever
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given admitted wake with only aborted assistant output after admission #then reply liveness is preserved", async () => {
    // given: an aborted (error) assistant message after admission is not
    // consumption — the parent never addressed the notification.
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    let aborted = false
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "idle" } },
      messagesProvider: () =>
        aborted
          ? [
              ...SAFE_MESSAGES,
              {
                info: {
                  role: "assistant",
                  finish: "stop",
                  time: { created: 101_000, completed: 101_500 },
                  error: { name: "MessageAbortedError" },
                },
                parts: [{ type: "text", text: "partial" }],
              },
            ]
          : BLOCKED_MESSAGES,
    })
    notifier.queuePendingParentWake("parent-1", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      // when: admitted as noReply while blocked
      await notifier.flushPendingParentWake("parent-1")
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)

      // when: the post-admission turn was aborted and the parent is now safe
      aborted = true
      now = 110_000
      releaseParentWakeHold("parent-1")
      notifier.clearPendingParentWakeTimer("parent-1")
      await notifier.flushPendingParentWake("parent-1")

      // then: liveness resume still fires exactly once
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

describe("BackgroundManager parent wake recent-activity admission liveness", () => {
  let managerUnderTest: BackgroundManager | undefined

  afterEach(() => {
    managerUnderTest?.shutdown()
    releaseAllPromptAsyncReservationsForTesting()
    managerUnderTest = undefined
  })

  function createManager(sessionStatuses: Record<string, { type: string }>): {
    manager: BackgroundManager
    promptAsyncCalls: PromptAsyncCall[]
  } {
    const promptAsyncCalls: PromptAsyncCall[] = []
    const client = {
      session: {
        messages: async () => [],
        status: async () => ({ data: sessionStatuses }),
        prompt: async () => ({}),
        promptAsync: async (call: PromptAsyncCall) => {
          promptAsyncCalls.push(call)
          return {}
        },
        abort: async () => ({}),
      },
    }
    const ctx: PluginInput = {
      client: client as PluginInput["client"],
      project: {} as PluginInput["project"],
      directory: tmpdir(),
      worktree: tmpdir(),
      serverUrl: new URL("http://localhost"),
      $: {} as PluginInput["$"],
    }

    const manager = new BackgroundManager({
      pluginContext: ctx,
      config: undefined,
      enableParentSessionNotifications: true,
    })

    return { manager, promptAsyncCalls }
  }

  test("#given completion admitted during fresh parent activity #then the parent resumes with a reply once activity goes stale", async () => {
    // given
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const sessionStatuses: Record<string, { type: string }> = {
      "parent-1": { type: "idle" },
    }
    const { manager, promptAsyncCalls } = createManager(sessionStatuses)
    managerUnderTest = manager
    manager.handleEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "parent-1",
        field: "reasoning",
        delta: "still thinking",
      },
    })
    const task: BackgroundTask = {
      id: "task-a",
      parentSessionId: "parent-1",
      parentMessageId: "parent-message-id",
      description: "task A",
      prompt: "Prompt for task-a",
      agent: "test-agent",
      status: "completed",
      startedAt: new Date("2026-05-20T14:19:10.000Z"),
      completedAt: new Date("2026-05-20T14:19:14.625Z"),
    }
    const tasks = Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
    tasks.set(task.id, task)
    const pendingByParent = Reflect.get(manager, "pendingByParent") as Map<string, Set<string>>
    pendingByParent.set(task.parentSessionId, new Set([task.id]))
    const notifyParentSession = Reflect.get(manager, "notifyParentSession") as (task: BackgroundTask) => Promise<void>
    const flushPendingParentWake = Reflect.get(manager, "flushPendingParentWake") as (sessionID: string) => Promise<void>
    const parentWakeNotifier = Reflect.get(manager, "parentWakeNotifier") as ParentWakeNotifier

    try {
      // when: the wake flushes while parent activity is still fresh
      await notifyParentSession.call(manager, task)
      await flushPendingParentWake.call(manager, "parent-1")

      // then: admitted as noReply but retained for a later resume
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(parentWakeNotifier.getPendingParentWakes().get("parent-1")?.shouldReply).toBe(true)

      // when: activity goes stale and the gate hold expires
      now = 110_000
      releaseParentWakeHold("parent-1")
      await flushPendingParentWake.call(manager, "parent-1")

      // then: the parent resumes exactly once with a reply-producing wake
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(JSON.stringify(promptAsyncCalls[1]?.body.parts)).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(parentWakeNotifier.getPendingParentWakes().has("parent-1")).toBe(false)
    } finally {
      Date.now = originalDateNow
    }
  })
})
