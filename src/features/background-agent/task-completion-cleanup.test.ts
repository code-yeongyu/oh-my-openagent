import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    noReply?: boolean
    parts?: unknown[]
  }
}

type FakeTimers = {
  getDelay: (timer: ReturnType<typeof setTimeout>) => number | undefined
  run: (timer: ReturnType<typeof setTimeout>) => void
  restore: () => void
}

let managerUnderTest: BackgroundManager | undefined
let fakeTimers: FakeTimers | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  fakeTimers?.restore()
  managerUnderTest = undefined
  fakeTimers = undefined
})

function createTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionID: string }): BackgroundTask {
  const id = overrides.id
  const parentSessionID = overrides.parentSessionID
  const { id: _ignoredID, parentSessionID: _ignoredParentSessionID, ...rest } = overrides

  return {
    parentMessageID: overrides.parentMessageID ?? "parent-message-id",
    description: overrides.description ?? overrides.id,
    prompt: overrides.prompt ?? `Prompt for ${overrides.id}`,
    agent: overrides.agent ?? "test-agent",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? new Date("2026-03-11T00:00:00.000Z"),
    ...rest,
    id,
    parentSessionID,
  }
}

function createManager(enableParentSessionNotifications: boolean): {
  manager: BackgroundManager
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      messages: async () => [],
      prompt: async () => ({}),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return {}
      },
      abort: async () => ({}),
    },
  }
  const placeholderClient = {} as PluginInput["client"]
  const ctx: PluginInput = {
    client: placeholderClient,
    project: {} as PluginInput["project"],
    directory: tmpdir(),
    worktree: tmpdir(),
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }

  const manager = new BackgroundManager(
    ctx,
    undefined,
    { enableParentSessionNotifications }
  )
  Reflect.set(manager, "client", client)

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

function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return Reflect.get(manager, "completionTimers") as Map<string, ReturnType<typeof setTimeout>>
}

async function notifyParentSessionForTest(manager: BackgroundManager, task: BackgroundTask): Promise<void> {
  const notifyParentSession = Reflect.get(manager, "notifyParentSession") as (task: BackgroundTask) => Promise<void>
  return notifyParentSession.call(manager, task)
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
      const taskA = createTask({ id: "task-a", parentSessionID: "parent-1", description: "task A", status: "completed", completedAt: new Date() })
      const taskB = createTask({ id: "task-b", parentSessionID: "parent-1", description: "task B", status: "running" })
      const taskC = createTask({ id: "task-c", parentSessionID: "parent-1", description: "task C", status: "pending" })
      getTasks(manager).set(taskA.id, taskA)
      getTasks(manager).set(taskB.id, taskB)
      getTasks(manager).set(taskC.id, taskC)
      getPendingByParent(manager).set(taskA.parentSessionID, new Set([taskA.id, taskB.id, taskC.id]))

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

  describe("#given 2 tasks for same parent and both completed", () => {
    test("#when the second completion notification is sent #then ALL BACKGROUND TASKS COMPLETE notification still works correctly", async () => {
      // given
      const { manager, promptAsyncCalls } = createManager(true)
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const taskA = createTask({ id: "task-a", parentSessionID: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      const taskB = createTask({ id: "task-b", parentSessionID: "parent-1", description: "task B", status: "running" })
      getTasks(manager).set(taskA.id, taskA)
      getTasks(manager).set(taskB.id, taskB)
      getPendingByParent(manager).set(taskA.parentSessionID, new Set([taskA.id, taskB.id]))

      await notifyParentSessionForTest(manager, taskA)
      taskB.status = "completed"
      taskB.completedAt = new Date("2026-03-11T00:02:00.000Z")

      // when
      await notifyParentSessionForTest(manager, taskB)

      // then
      expect(promptAsyncCalls).toHaveLength(2)
      expect(getCompletionTimers(manager).size).toBe(2)
      const allCompleteCall = promptAsyncCalls[1]
      expect(allCompleteCall).toBeDefined()
      if (!allCompleteCall) {
        throw new Error("Missing all-complete notification call")
      }

      expect(allCompleteCall.body.noReply).toBe(false)
      const allCompletePayload = JSON.stringify(allCompleteCall.body.parts)
      expect(allCompletePayload).toContain("ALL BACKGROUND TASKS COMPLETE")
      expect(allCompletePayload).toContain(taskA.id)
      expect(allCompletePayload).toContain(taskB.id)
      expect(allCompletePayload).toContain(taskA.description)
      expect(allCompletePayload).toContain(taskB.description)
    })
  })

  describe("#given a completed task with cleanup timer scheduled", () => {
    test("#when cleanup timer fires #then task is deleted from this.tasks Map", async () => {
      // given
      const { manager } = createManager(false)
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const task = createTask({ id: "task-a", parentSessionID: "parent-1", description: "task A", status: "completed", completedAt: new Date("2026-03-11T00:01:00.000Z") })
      getTasks(manager).set(task.id, task)
      getPendingByParent(manager).set(task.parentSessionID, new Set([task.id]))

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
