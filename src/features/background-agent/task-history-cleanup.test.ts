import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { TaskHistory } from "./task-history"
import type { BackgroundTask } from "./types"

let managerUnderTest: BackgroundManager | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  managerUnderTest = undefined
})

function createManager(): BackgroundManager {
  const client = {
    session: {
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

  const manager = new BackgroundManager(ctx)
  Reflect.set(manager, "client", client)

  return manager
}

function createTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionID: string }): BackgroundTask {
  const { id, parentSessionID, ...rest } = overrides

  return {
    ...rest,
    id,
    parentSessionID,
    parentMessageID: rest.parentMessageID ?? "parent-message-id",
    description: rest.description ?? id,
    prompt: rest.prompt ?? `Prompt for ${id}`,
    agent: rest.agent ?? "test-agent",
    status: rest.status ?? "running",
    startedAt: rest.startedAt ?? new Date("2026-03-11T00:00:00.000Z"),
  }
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
}

function pruneStaleTasksAndNotificationsForTest(manager: BackgroundManager): void {
  const pruneStaleTasksAndNotifications = Reflect.get(manager, "pruneStaleTasksAndNotifications") as () => void
  pruneStaleTasksAndNotifications.call(manager)
}

describe("task history cleanup", () => {
  test("#given TaskHistory with entries for multiple parents #when clearSession called for one parent #then only that parent's entries are removed, others remain", () => {
    // given
    const history = new TaskHistory()
    history.record("parent-1", { id: "task-1", agent: "explore", description: "task 1", status: "pending" })
    history.record("parent-2", { id: "task-2", agent: "oracle", description: "task 2", status: "running" })

    // when
    history.clearSession("parent-1")

    // then
    expect(history.getByParentSession("parent-1")).toHaveLength(0)
    expect(history.getByParentSession("parent-2")).toHaveLength(1)
  })

  test("#given TaskHistory with entries for multiple parents #when clearAll called #then all entries are removed", () => {
    // given
    const history = new TaskHistory()
    history.record("parent-1", { id: "task-1", agent: "explore", description: "task 1", status: "pending" })
    history.record("parent-2", { id: "task-2", agent: "oracle", description: "task 2", status: "running" })

    // when
    history.clearAll()

    // then
    expect(history.getByParentSession("parent-1")).toHaveLength(0)
    expect(history.getByParentSession("parent-2")).toHaveLength(0)
  })

  test("#given BackgroundManager with taskHistory entries #when shutdown() called #then taskHistory is cleared via clearAll()", () => {
    // given
    const manager = createManager()
    managerUnderTest = manager
    manager.taskHistory.record("parent-1", { id: "task-1", agent: "explore", description: "task 1", status: "pending" })

    let clearAllCalls = 0
    const originalClearAll = manager.taskHistory.clearAll.bind(manager.taskHistory)
    manager.taskHistory.clearAll = (): void => {
      clearAllCalls += 1
      originalClearAll()
    }

    // when
    manager.shutdown()

    // then
    expect(clearAllCalls).toBe(1)
    expect(manager.taskHistory.getByParentSession("parent-1")).toHaveLength(0)

    managerUnderTest = undefined
  })

  test("#given BackgroundManager with stale tasks for one parent #when pruneStaleTasksAndNotifications() runs #then history is preserved until delayed cleanup", () => {
    // given
    const manager = createManager()
    managerUnderTest = manager
    const staleTask = createTask({
      id: "task-stale",
      parentSessionID: "parent-1",
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    })
    const liveTask = createTask({
      id: "task-live",
      parentSessionID: "parent-2",
      startedAt: new Date(),
    })

    getTaskMap(manager).set(staleTask.id, staleTask)
    getTaskMap(manager).set(liveTask.id, liveTask)
    manager.taskHistory.record("parent-1", { id: staleTask.id, agent: staleTask.agent, description: staleTask.description, status: staleTask.status })
    manager.taskHistory.record("parent-2", { id: liveTask.id, agent: liveTask.agent, description: liveTask.description, status: liveTask.status })

    // when
    pruneStaleTasksAndNotificationsForTest(manager)

    // then
    expect(manager.taskHistory.getByParentSession("parent-1")).toHaveLength(1)
    expect(manager.taskHistory.getByParentSession("parent-2")).toHaveLength(1)
  })
})
