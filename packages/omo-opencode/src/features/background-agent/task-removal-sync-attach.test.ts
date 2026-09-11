import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type FakeTimers = {
  getDelay: (timer: ReturnType<typeof setTimeout>) => number | undefined
  run: (timer: ReturnType<typeof setTimeout>) => Promise<void>
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

function createManager(): { manager: BackgroundManager; deleteCalls: string[] } {
  const deleteCalls: string[] = []
  const client = {
    session: {
      messages: async () => [],
      status: async () => ({ data: {} }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      delete: async (input: { path: { id: string } }) => {
        deleteCalls.push(input.path.id)
        return {}
      },
    },
  }
  const ctx: PluginInput = {
    client: client as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: tmpdir(),
    worktree: tmpdir(),
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }

  const manager = new BackgroundManager({ pluginContext: ctx, config: undefined, enableParentSessionNotifications: false })
  return { manager, deleteCalls }
}

function createCompletedTask(id: string, sessionId: string): BackgroundTask {
  return {
    id,
    sessionId,
    parentSessionId: "parent-1",
    parentMessageId: "parent-message-id",
    description: id,
    prompt: `Prompt for ${id}`,
    agent: "test-agent",
    status: "completed",
    startedAt: new Date("2026-03-11T00:00:00.000Z"),
    completedAt: new Date("2026-03-11T00:01:00.000Z"),
  }
}

function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void | Promise<void>>()
  const delays = new Map<ReturnType<typeof setTimeout>, number>()

  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof handler !== "function") {
      throw new Error("Expected function timeout handler")
    }

    const timer = originalSetTimeout(() => {}, 60_000)
    originalClearTimeout(timer)
    const callback = handler as (...callbackArgs: Array<unknown>) => void
    callbacks.set(timer, () => callback(...args))
    delays.set(timer, Math.max(0, delay ?? 0))
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
    async run(timer) {
      const callback = callbacks.get(timer)
      if (!callback) {
        throw new Error(`Timer not found: ${String(timer)}`)
      }

      callbacks.delete(timer)
      delays.delete(timer)
      await callback()
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve()
      }
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

function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return Reflect.get(manager, "completionTimers") as Map<string, ReturnType<typeof setTimeout>>
}

function scheduleTaskRemovalForTest(manager: BackgroundManager, taskID: string): void {
  const scheduleTaskRemoval = Reflect.get(manager, "scheduleTaskRemoval") as (taskId: string) => void
  scheduleTaskRemoval.call(manager, taskID)
}

function getRequiredTimer(manager: BackgroundManager, taskID: string): ReturnType<typeof setTimeout> {
  const timer = getCompletionTimers(manager).get(taskID)
  expect(timer).toBeDefined()
  if (timer === undefined) {
    throw new Error(`Missing completion timer for ${taskID}`)
  }

  return timer
}

describe("BackgroundManager.scheduleTaskRemoval with an attached sync continuation", () => {
  describe("#given a completed task whose cleanup timer is armed", () => {
    test("#when a sync continuation is attached and the timer fires #then the task is kept and the session is not deleted", async () => {
      // given
      const { manager, deleteCalls } = createManager()
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const task = createCompletedTask("task-a", "ses_child")
      getTasks(manager).set(task.id, task)
      scheduleTaskRemovalForTest(manager, task.id)
      const cleanupTimer = getRequiredTimer(manager, task.id)
      expect(fakeTimers.getDelay(cleanupTimer)).toBe(TASK_CLEANUP_DELAY_MS)

      // when
      manager.attachSyncContinuation("ses_child")
      await fakeTimers.run(cleanupTimer)

      // then
      expect(getTasks(manager).has(task.id)).toBe(true)
      expect(manager.findBySession("ses_child")).toBe(task)
      expect(deleteCalls).toEqual([])
    })

    test("#when the sync continuation detaches #then a fresh cleanup timer is armed and firing it removes the task and deletes the session once", async () => {
      // given
      const { manager, deleteCalls } = createManager()
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const task = createCompletedTask("task-a", "ses_child")
      getTasks(manager).set(task.id, task)
      scheduleTaskRemovalForTest(manager, task.id)
      const detach = manager.attachSyncContinuation("ses_child")
      await fakeTimers.run(getRequiredTimer(manager, task.id))
      expect(getCompletionTimers(manager).has(task.id)).toBe(false)

      // when
      detach()

      // then
      const rearmedTimer = getRequiredTimer(manager, task.id)
      expect(fakeTimers.getDelay(rearmedTimer)).toBe(TASK_CLEANUP_DELAY_MS)

      // when
      await fakeTimers.run(rearmedTimer)

      // then
      expect(getTasks(manager).has(task.id)).toBe(false)
      expect(manager.findBySession("ses_child")).toBeUndefined()
      expect(deleteCalls).toEqual(["ses_child"])
    })

    test("#when the sync continuation detaches before the timer fires #then the pending timer is left alone", async () => {
      // given
      const { manager, deleteCalls } = createManager()
      managerUnderTest = manager
      fakeTimers = installFakeTimers()
      const task = createCompletedTask("task-a", "ses_child")
      getTasks(manager).set(task.id, task)
      scheduleTaskRemovalForTest(manager, task.id)
      const originalTimer = getRequiredTimer(manager, task.id)

      // when
      const detach = manager.attachSyncContinuation("ses_child")
      detach()

      // then
      expect(getCompletionTimers(manager).get(task.id)).toBe(originalTimer)

      // when
      await fakeTimers.run(originalTimer)

      // then
      expect(getTasks(manager).has(task.id)).toBe(false)
      expect(deleteCalls).toEqual(["ses_child"])
    })
  })

  describe("#given a session that is not tracked as a background task", () => {
    test("#when a sync continuation attaches and detaches #then no cleanup timer is created", () => {
      // given
      const { manager, deleteCalls } = createManager()
      managerUnderTest = manager
      fakeTimers = installFakeTimers()

      // when
      const detach = manager.attachSyncContinuation("ses_sync_only")
      detach()

      // then
      expect(getCompletionTimers(manager).size).toBe(0)
      expect(deleteCalls).toEqual([])
    })
  })
})
