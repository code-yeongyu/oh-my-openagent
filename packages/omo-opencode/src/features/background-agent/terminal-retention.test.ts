import { expect, test } from "bun:test"
import { pruneStaleTasksAndNotifications } from "./task-poller"
import { TERMINAL_TASK_TTL_MS } from "./constants"
import type { BackgroundTask } from "./types"

function terminalTask(status: BackgroundTask["status"] = "completed"): BackgroundTask {
  return {
    id: "terminal", parentSessionId: "parent", parentMessageId: "message",
    description: "finished task", prompt: "input", agent: "explore", status,
    completedAt: new Date(Date.now() - TERMINAL_TASK_TTL_MS - 1000),
  }
}

test("preserves the existing terminal TTL when cleanup delay is unset", () => {
  const task = terminalTask()
  const tasks = new Map([[task.id, task]])
  pruneStaleTasksAndNotifications({ tasks, notifications: new Map(), onTaskPruned: () => {} })
  expect(tasks.has(task.id)).toBe(false)
})

for (const status of ["completed", "error", "cancelled", "interrupt"] as const) {
  test(`keeps ${status} records past the old TTL until configured cleanup expires`, () => {
    const task = terminalTask(status)
    const tasks = new Map([[task.id, task]])
    const options = {
      tasks, notifications: new Map<string, BackgroundTask[]>(),
      taskCleanupDelayMs: TERMINAL_TASK_TTL_MS * 2,
      onTaskPruned: () => {},
    }
    pruneStaleTasksAndNotifications(options)
    expect(tasks.get(task.id)).toBe(task)
  })
}

test("does not prune a terminal record with a pending notification", () => {
  const task = terminalTask()
  const tasks = new Map([[task.id, task]])
  const options = { tasks, notifications: new Map([["parent", [task]]]), taskCleanupDelayMs: 60_000, onTaskPruned: () => {} }
  pruneStaleTasksAndNotifications(options)
  expect(tasks.get(task.id)).toBe(task)
})

test("does not prune a terminal record before the terminal TTL floor", () => {
  const task = terminalTask()
  task.completedAt = new Date(Date.now() - 20 * 60 * 1000)
  const tasks = new Map([[task.id, task]])
  const options = { tasks, notifications: new Map<string, BackgroundTask[]>(), taskCleanupDelayMs: 5 * 60 * 1000, onTaskPruned: () => {} }
  pruneStaleTasksAndNotifications(options)
  expect(tasks.get(task.id)).toBe(task)
})

test("does not prune a terminal record with a pending removal timer", () => {
  const task = terminalTask()
  const tasks = new Map([[task.id, task]])
  const options = {
    tasks, notifications: new Map<string, BackgroundTask[]>(),
    taskCleanupDelayMs: 5 * 60 * 1000,
    hasPendingRemovalTimer: () => true,
    onTaskPruned: () => {},
  }
  pruneStaleTasksAndNotifications(options)
  expect(tasks.get(task.id)).toBe(task)
})

test("does not prune a terminal record with an attached sync session", () => {
  const task = { ...terminalTask(), sessionId: "ses-sync" }
  const tasks = new Map([[task.id, task]])
  const options = {
    tasks, notifications: new Map<string, BackgroundTask[]>(),
    taskCleanupDelayMs: 5 * 60 * 1000,
    hasAttachedSyncSession: (sessionID: string) => sessionID === "ses-sync",
    onTaskPruned: () => {},
  }
  pruneStaleTasksAndNotifications(options)
  expect(tasks.get(task.id)).toBe(task)
})
