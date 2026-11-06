import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { TERMINAL_TASK_TTL_MS } from "./constants"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

let managerUnderTest: BackgroundManager | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  managerUnderTest = undefined
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

function createExpiredTask(id: string): BackgroundTask {
  return {
    id,
    parentSessionId: "parent-1",
    parentMessageId: "parent-message-id",
    description: id,
    prompt: `Prompt for ${id}`,
    agent: "test-agent",
    status: "completed",
    startedAt: new Date(Date.now() - TERMINAL_TASK_TTL_MS - 120_000),
    completedAt: new Date(Date.now() - TERMINAL_TASK_TTL_MS - 60_000),
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

function runManagerPrune(manager: BackgroundManager): void {
  const prune = Reflect.get(manager, "pruneStaleTasksAndNotifications") as (allStatuses?: Record<string, { type: string }>) => void
  prune.call(manager, undefined)
}

describe("BackgroundManager terminal prune leaves records to their owning cleanup paths", () => {
  describe("#given a finished task past the terminal TTL whose removal timer is still pending", () => {
    test("#when the manager's prune runs #then the record stays with its timer and the session is kept", () => {
      const { manager, deleteCalls } = createManager()
      managerUnderTest = manager
      const task = { ...createExpiredTask("task-timer"), sessionId: "ses-timer" }
      getTasks(manager).set(task.id, task)
      scheduleTaskRemovalForTest(manager, task.id)
      expect(getCompletionTimers(manager).has(task.id)).toBe(true)

      runManagerPrune(manager)

      expect(getTasks(manager).get(task.id)).toBe(task)
      expect(getCompletionTimers(manager).has(task.id)).toBe(true)
      expect(manager.findBySession("ses-timer")).toBe(task)
      expect(deleteCalls).toEqual([])
    })
  })

  describe("#given a finished task past the terminal TTL with an attached sync continuation", () => {
    test("#when the manager's prune runs #then the record stays for the sync waiter and the session is kept", () => {
      const { manager, deleteCalls } = createManager()
      managerUnderTest = manager
      const task = { ...createExpiredTask("task-sync"), sessionId: "ses-sync" }
      getTasks(manager).set(task.id, task)
      manager.attachSyncContinuation("ses-sync")
      expect(getCompletionTimers(manager).has(task.id)).toBe(false)

      runManagerPrune(manager)

      expect(getTasks(manager).get(task.id)).toBe(task)
      expect(manager.findBySession("ses-sync")).toBe(task)
      expect(deleteCalls).toEqual([])
    })
  })
})
