import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"

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

type SessionMessageForTest = {
  info?: {
    role?: string
    finish?: string
    time?: { created?: number }
  }
  parts?: Array<{ type?: string }>
}

type FakeTimers = {
  getDelay: (timer: ReturnType<typeof setTimeout>) => number | undefined
  run: (timer: ReturnType<typeof setTimeout>) => void
  restore: () => void
}

type PendingParentWakeForTest = {
  promptContext?: Record<string, unknown>
  notifications: string[]
  shouldReply: boolean
  toolCallDeferralStartedAt?: number
}

let managerUnderTest: BackgroundManager | undefined
let fakeTimers: FakeTimers | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  fakeTimers?.restore()
  releaseAllPromptAsyncReservationsForTesting()
  managerUnderTest = undefined
  fakeTimers = undefined
})

function createTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string }): BackgroundTask {
  const id = overrides.id
  const parentSessionID = overrides.parentSessionId
  const { id: _ignoredID, parentSessionId: _ignoredParentSessionID, ...rest } = overrides

  return {
    parentMessageId: overrides.parentMessageId ?? "parent-message-id",
    description: overrides.description ?? overrides.id,
    prompt: overrides.prompt ?? `Prompt for ${overrides.id}`,
    agent: overrides.agent ?? "test-agent",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? new Date("2026-03-11T00:00:00.000Z"),
    ...rest,
    id,
    parentSessionId: parentSessionID,
  }
}

function createManager(enableParentSessionNotifications: boolean): {
  manager: BackgroundManager
  promptAsyncCalls: PromptAsyncCall[]
}
function createManager(
  enableParentSessionNotifications: boolean,
  sessionStatuses?: Record<string, { type: string }>,
  promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>,
  sessionMessages: SessionMessageForTest[] = [],
): {
  manager: BackgroundManager
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      messages: async () => sessionMessages,
      status: async () => ({ data: sessionStatuses ?? {} }),
      prompt: async () => ({}),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        if (promptAsyncImpl) {
          return promptAsyncImpl(call)
        }
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

  const manager = new BackgroundManager(
    { pluginContext: ctx, config: undefined, enableParentSessionNotifications }
  )

  return { manager, promptAsyncCalls }
}

function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>()
  const delays = new Map<ReturnType<typeof setTimeout>, number>()

  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof handler !== "function") {
      throw new Error("Expected function timeout handler")
    }

    const timer = originalSetTimeout(() => {}, 60_000)
    originalClearTimeout(timer)
    const callback = handler as (...callbackArgs: Array<unknown>) => void
    callbacks.set(timer, () => callback(...args))
    delays.set(timer, delay ?? 0)
    return timer
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>): void => {
    callbacks.delete(timer)
    delays.delete(timer)
  }) as typeof clearTimeout

  return {
    getDelay(timer) {
      return delays.get(timer)
    },
    run(timer) {
      const callback = callbacks.get(timer)
      if (!callback) {
        throw new Error(`Timer not found: ${String(timer)}`)
      }

      callbacks.delete(timer)
      delays.delete(timer)
      callback()
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
  }
}

function getTasks(manager: BackgroundManager): Map<string, BackgroundTask> {
  return Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
}

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return Reflect.get(manager, "pendingByParent") as Map<string, Set<string>>
}

function getPendingNotifications(manager: BackgroundManager): Map<string, string[]> {
  return Reflect.get(manager, "pendingNotifications") as Map<string, string[]>
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, PendingParentWakeForTest> {
  const parentWakeNotifier = Reflect.get(manager, "parentWakeNotifier") as {
    getPendingParentWakes: () => Map<string, PendingParentWakeForTest>
  }
  return parentWakeNotifier.getPendingParentWakes()
}

function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return Reflect.get(manager, "completionTimers") as Map<string, ReturnType<typeof setTimeout>>
}

async function notifyParentSessionForTest(manager: BackgroundManager, task: BackgroundTask): Promise<void> {
  const notifyParentSession = Reflect.get(manager, "notifyParentSession") as (task: BackgroundTask) => Promise<void>
  return notifyParentSession.call(manager, task)
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function waitForDeferredWake(promptAsyncCalls: PromptAsyncCall[]): Promise<void> {
  return waitUntil(() => promptAsyncCalls.length > 0, 600)
}

function waitForDeferredWakeRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1_180))
}

function waitForRequeuedParentWake(manager: BackgroundManager, sessionID: string): Promise<void> {
  return waitUntil(() => (getPendingParentWakes(manager).get(sessionID)?.notifications.length ?? 0) > 0, 600)
}

function waitForCoalescedFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400))
}

function getRequiredTimer(manager: BackgroundManager, taskID: string): ReturnType<typeof setTimeout> {
  const timer = getCompletionTimers(manager).get(taskID)
  expect(timer).toBeDefined()
  if (timer === undefined) {
    throw new Error(`Missing completion timer for ${taskID}`)
  }

  return timer
}

describe("BackgroundManager.notifyParentSession cleanup scheduling", () => {
  describe("#given 3 tasks for same parent and task A completed first", () => {
    test("#when siblings are still running or pending #then task A remains until siblings also complete", async () => {
      // given
      const { manager } = createManager(false)
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const taskA = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date() })
      const taskB = createTask({ id: "task-b", parentSessionId: "parent-1", description: "task B", status: "running" })
      const taskC = createTask({ id: "task-c", parentSessionId: "parent-1", description: "task C", status: "pending" })
      getTasks(manager).set(taskA.id, taskA)
      getTasks(manager).set(taskB.id, taskB)
      getTasks(manager).set(taskC.id, taskC)
      getPendingByParent(manager).set(taskA.parentSessionId, new Set([taskA.id, taskB.id, taskC.id]))

      // when
      await notifyParentSessionForTest(manager, taskA)
      const taskATimer = getRequiredTimer(manager, taskA.id)
      expect(fakeTimers.getDelay(taskATimer)).toBe(TASK_CLEANUP_DELAY_MS)
      fakeTimers.run(taskATimer)

      // then
      expect(fakeTimers.getDelay(taskATimer)).toBeUndefined()
      expect(getTasks(manager).has(taskA.id)).toBe(true)
      expect(getTasks(manager).get(taskB.id)).toBe(taskB)
      expect(getTasks(manager).get(taskC.id)).toBe(taskC)

      // when
      taskB.status = "completed"
      taskB.completedAt = new Date()
      taskC.status = "completed"
      taskC.completedAt = new Date()
      await notifyParentSessionForTest(manager, taskB)
      await notifyParentSessionForTest(manager, taskC)
      const rescheduledTaskATimer = getRequiredTimer(manager, taskA.id)
      expect(fakeTimers.getDelay(rescheduledTaskATimer)).toBe(TASK_CLEANUP_DELAY_MS)
      fakeTimers.run(rescheduledTaskATimer)

      // then
      expect(getTasks(manager).has(taskA.id)).toBe(false)
    })
  })

  describe("#given background tasks for same parent", () => {
    test("#when two completions arrive back-to-back while parent is idle #then one batched notification is sent with both tasks", async () => {
      // given
      const { manager, promptAsyncCalls } = createManager(true)
      managerUnderTest = manager
      const taskA = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      const taskB = createTask({ id: "task-b", parentSessionId: "parent-1", description: "task B", status: "running" })
      getTasks(manager).set(taskA.id, taskA)
      getTasks(manager).set(taskB.id, taskB)
      getPendingByParent(manager).set(taskA.parentSessionId, new Set([taskA.id, taskB.id]))

      await notifyParentSessionForTest(manager, taskA)
      taskB.status = "completed"
      taskB.completedAt = new Date("2026-03-11T00:02:00.000Z")

      // when
      await notifyParentSessionForTest(manager, taskB)
      await waitForCoalescedFlush()

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      const batchedCall = promptAsyncCalls[0]
      if (!batchedCall) {
        throw new Error("Missing batched notification call")
      }
      expect(batchedCall.body.noReply).toBe(false)
      const batchedPayload = JSON.stringify(batchedCall.body.parts)
      expect(batchedPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(batchedPayload).toContain(OMO_INTERNAL_INITIATOR_MARKER)
      expect(batchedPayload).toContain(taskA.id)
      expect(batchedPayload).toContain(taskB.id)
      expect(batchedPayload).toContain(taskA.description)
      expect(batchedPayload).toContain(taskB.description)
    })

    test("#when many completions arrive in rapid succession while parent is idle #then a single coalesced notification is sent", async () => {
      // given
      const { manager, promptAsyncCalls } = createManager(true)
      managerUnderTest = manager
      const taskIds = ["task-1", "task-2", "task-3", "task-4", "task-5"]
      const tasks = taskIds.map((id, index) => createTask({
        id,
        parentSessionId: "parent-1",
        description: `description ${id}`,
        status: "completed",
        completedAt: new Date(`2026-03-11T00:01:0${index}.000Z`),
      }))
      for (const task of tasks) {
        getTasks(manager).set(task.id, task)
      }
      getPendingByParent(manager).set("parent-1", new Set(taskIds))

      // when
      for (const task of tasks) {
        await notifyParentSessionForTest(manager, task)
      }
      await waitForCoalescedFlush()

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      const batchedCall = promptAsyncCalls[0]
      if (!batchedCall) {
        throw new Error("Missing batched notification call")
      }
      expect(batchedCall.body.noReply).toBe(false)
      const batchedPayload = JSON.stringify(batchedCall.body.parts)
      expect(batchedPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
      for (const task of tasks) {
        expect(batchedPayload).toContain(task.id)
        expect(batchedPayload).toContain(task.description)
      }
    })

    test("#when parent session is busy #then all-complete notification does not start an overlapping parent reply", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses)
      managerUnderTest = manager
      const task = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      // when
      await notifyParentSessionForTest(manager, task)

      // then
      expect(promptAsyncCalls).toHaveLength(0)
    })

    test("#when partial completion arrives while parent session is busy #then notification waits until idle without waking a reply", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses)
      managerUnderTest = manager
      const taskA = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      const taskB = createTask({ id: "task-b", parentSessionId: "parent-1", description: "task B", status: "running" })
      getTasks(manager).set(taskA.id, taskA)
      getTasks(manager).set(taskB.id, taskB)
      getPendingByParent(manager).set(taskA.parentSessionId, new Set([taskA.id, taskB.id]))

      // when
      await notifyParentSessionForTest(manager, taskA)

      // then
      expect(promptAsyncCalls).toHaveLength(0)

      // when
      sessionStatuses["parent-1"] = { type: "idle" }
      manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
      await waitForDeferredWake(promptAsyncCalls)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      const notificationPayload = JSON.stringify(promptAsyncCalls[0]?.body.parts)
      expect(notificationPayload).toContain("BACKGROUND TASK COMPLETED")
      expect(notificationPayload).not.toContain("ALL BACKGROUND TASKS COMPLETE")
    })

    test("#when partial and all-complete notifications queue while parent session is busy #then idle flushes one reply wake", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses)
      managerUnderTest = manager
      const taskA = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      const taskB = createTask({ id: "task-b", parentSessionId: "parent-1", description: "task B", status: "running" })
      getTasks(manager).set(taskA.id, taskA)
      getTasks(manager).set(taskB.id, taskB)
      getPendingByParent(manager).set(taskA.parentSessionId, new Set([taskA.id, taskB.id]))

      await notifyParentSessionForTest(manager, taskA)
      taskB.status = "completed"
      taskB.completedAt = new Date("2026-03-11T00:02:00.000Z")

      // when
      await notifyParentSessionForTest(manager, taskB)

      // then
      expect(promptAsyncCalls).toHaveLength(0)

      // when
      sessionStatuses["parent-1"] = { type: "idle" }
      manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
      await waitForDeferredWake(promptAsyncCalls)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      const notificationPayload = JSON.stringify(promptAsyncCalls[0]?.body.parts)
      expect(notificationPayload).toContain("BACKGROUND TASK COMPLETED")
      expect(notificationPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(notificationPayload).toContain(taskA.id)
      expect(notificationPayload).toContain(taskB.id)
    })

    test("#when retry no-reply notification batches with final completion #then idle flush sends one reply wake", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses)
      managerUnderTest = manager
      const queuePendingParentWake = Reflect.get(manager, "queuePendingParentWake") as (
        sessionID: string,
        notification: string,
        promptContext: Record<string, unknown>,
        shouldReply: boolean,
        delayMs?: number,
      ) => void
      queuePendingParentWake.call(
        manager,
        "parent-1",
        "<system-reminder>\n[BACKGROUND TASK RETRYING]\n</system-reminder>",
        {},
        false,
        0,
      )
      const task = createTask({
        id: "task-a",
        parentSessionId: "parent-1",
        description: "task A",
        status: "completed",
        completedAt: new Date("2026-03-11T00:02:00.000Z"),
      })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      // when
      await notifyParentSessionForTest(manager, task)
      sessionStatuses["parent-1"] = { type: "idle" }
      manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
      await waitForDeferredWake(promptAsyncCalls)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      const notificationPayload = JSON.stringify(promptAsyncCalls[0]?.body.parts)
      expect(notificationPayload).toContain("BACKGROUND TASK RETRYING")
      expect(notificationPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
    })

    test("#when parent status is idle but latest assistant turn is still waiting on tool results #then background completion does not fork a reply", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "idle" },
      }
      const sessionMessages: SessionMessageForTest[] = [
        {
          info: { role: "user", time: { created: 1778819814009 } },
          parts: [{ type: "text" }],
        },
        {
          info: { role: "assistant", finish: "tool-calls", time: { created: 1778819997535 } },
          parts: [{ type: "tool" }],
        },
      ]
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses, undefined, sessionMessages)
      managerUnderTest = manager
      const task = createTask({
        id: "task-a",
        parentSessionId: "parent-1",
        description: "task A",
        status: "completed",
        completedAt: new Date("2026-05-15T13:40:19.368Z"),
      })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      // when
      await notifyParentSessionForTest(manager, task)
      await waitForCoalescedFlush()

      // then
      expect(promptAsyncCalls).toHaveLength(0)
    })

    test("#when stale tool-call history keeps blocking an all-complete wake #then completion eventually wakes the parent", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "idle" },
      }
      const sessionMessages: SessionMessageForTest[] = [
        {
          info: { role: "user", time: { created: 1778819814009 } },
          parts: [{ type: "text" }],
        },
        {
          info: { role: "assistant", finish: "tool-calls", time: { created: 1778819997535 } },
          parts: [{ type: "tool" }],
        },
      ]
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses, undefined, sessionMessages)
      managerUnderTest = manager
      const task = createTask({
        id: "task-a",
        parentSessionId: "parent-1",
        description: "task A",
        status: "completed",
        completedAt: new Date("2026-05-15T13:40:19.368Z"),
      })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))
      await notifyParentSessionForTest(manager, task)
      await waitForCoalescedFlush()
      const pendingWake = getPendingParentWakes(manager).get("parent-1")
      expect(pendingWake).toBeDefined()
      if (!pendingWake) {
        throw new Error("Missing pending parent wake")
      }
      pendingWake.toolCallDeferralStartedAt = Date.now() - 60_000

      // when
      manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
      await waitForDeferredWake(promptAsyncCalls)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      const notificationPayload = JSON.stringify(promptAsyncCalls[0]?.body.parts)
      expect(notificationPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
    })

    test("#when all-complete notification wakes parent #then prompt stays in the same OpenCode directory instance", async () => {
      // given
      const { manager, promptAsyncCalls } = createManager(true)
      managerUnderTest = manager
      const directory = Reflect.get(manager, "directory") as string
      const task = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      // when
      await notifyParentSessionForTest(manager, task)
      await waitForCoalescedFlush()

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      expect(promptAsyncCalls[0]?.query).toEqual({ directory })
    })

    test("#when busy parent later becomes idle #then completion notification wakes the parent once", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses)
      managerUnderTest = manager
      const task = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))
      await notifyParentSessionForTest(manager, task)
      expect(promptAsyncCalls).toHaveLength(0)

      // when
      sessionStatuses["parent-1"] = { type: "idle" }
      manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
      await waitForDeferredWake(promptAsyncCalls)

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      const notificationPayload = JSON.stringify(promptAsyncCalls[0]?.body.parts)
      expect(notificationPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(notificationPayload).not.toContain("BACKGROUND TASK NOTIFICATION READY")
    })

    test("#when a single background task finishes during a stale busy parent status #then completion notification is retried after the parent becomes idle", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses)
      managerUnderTest = manager
      const task = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      // when
      await notifyParentSessionForTest(manager, task)
      sessionStatuses["parent-1"] = { type: "idle" }
      await waitForDeferredWakeRetry()

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(false)
      const notificationPayload = JSON.stringify(promptAsyncCalls[0]?.body.parts)
      expect(notificationPayload).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(notificationPayload).not.toContain("BACKGROUND TASK NOTIFICATION READY")
    })

    test("#when completion notification send is aborted #then parent wake is requeued for retry", async () => {
      // given
      const sessionStatuses: Record<string, { type: string }> = {
        "parent-1": { type: "busy" },
      }
      const promptError = new Error("Request aborted while waiting for input")
      promptError.name = "MessageAbortedError"
      const { manager, promptAsyncCalls } = createManager(true, sessionStatuses, async () => {
        throw promptError
      })
      managerUnderTest = manager
      const task = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      // when
      await notifyParentSessionForTest(manager, task)
      sessionStatuses["parent-1"] = { type: "idle" }
      manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
      await waitForDeferredWake(promptAsyncCalls)
      await waitForRequeuedParentWake(manager, "parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(getPendingNotifications(manager).get("parent-1")).toBeUndefined()
      const queuedNotifications = getPendingParentWakes(manager).get("parent-1")?.notifications ?? []
      expect(queuedNotifications).toHaveLength(1)
      expect(queuedNotifications[0]).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(queuedNotifications[0]).not.toContain("BACKGROUND TASK NOTIFICATION READY")
    })
  })

  describe("#given a completed task with cleanup timer scheduled", () => {
    test("#when cleanup timer fires #then task is deleted from this.tasks Map", async () => {
      // given
      const { manager } = createManager(false)
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const task = createTask({ id: "task-a", parentSessionId: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

      await notifyParentSessionForTest(manager, task)
      const cleanupTimer = getRequiredTimer(manager, task.id)

      // when
      expect(fakeTimers.getDelay(cleanupTimer)).toBe(TASK_CLEANUP_DELAY_MS)
      fakeTimers.run(cleanupTimer)

      // then
      expect(getCompletionTimers(manager).has(task.id)).toBe(false)
      expect(getTasks(manager).has(task.id)).toBe(false)
    })
  })
})
