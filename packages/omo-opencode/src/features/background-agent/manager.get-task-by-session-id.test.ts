/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { tmpdir } from "os"
import type { BackgroundTask } from "./types"
import { BackgroundManager } from "./manager"
import { clearBackgroundTaskRegistryForTesting } from "./task-registry"

function cast<T>(value: unknown): T {
  return value as T
}

function createPluginInput(client: unknown, directory = tmpdir()): PluginInput {
  return cast<PluginInput>({ client, directory })
}

function createBackgroundManager(): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }
  return new BackgroundManager({ pluginContext: createPluginInput(client) })
}

const TASK_ID = "bg_session1"
const SESSION_ID = "ses-tracked-child"
const PARENT_SESSION_ID = "parent-session"

async function trackTrackedTask(manager: BackgroundManager): Promise<BackgroundTask> {
  return manager.trackTask({
    taskId: TASK_ID,
    sessionId: SESSION_ID,
    parentSessionId: PARENT_SESSION_ID,
    description: "tracked task",
    agent: "explore",
  })
}

function completeTask(task: BackgroundTask): void {
  task.status = "completed"
  task.completedAt = new Date()
}

beforeEach(() => {
  clearBackgroundTaskRegistryForTesting()
})

describe("BackgroundManager.getTaskBySessionId", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("#given a live tracked task #when looked up by session ID #then the live task is returned", async () => {
    // given
    const task = await trackTrackedTask(manager)

    // when
    const found = manager.getTaskBySessionId(SESSION_ID)

    // then
    expect(found?.id).toBe(task.id)
    expect(found?.sessionId).toBe(SESSION_ID)
  })

  test("#given a completed task removed from the live map #when looked up by bg_ id or session ID #then both resolve from the completed-task archive", async () => {
    // given
    const task = await trackTrackedTask(manager)
    completeTask(task)

    // when
    cast<{ removeTask: (task: BackgroundTask) => void }>(manager).removeTask(task)
    const byBgId = manager.getTask(TASK_ID)
    const bySessionId = manager.getTaskBySessionId(SESSION_ID)

    // then
    expect(byBgId?.id).toBe(TASK_ID)
    expect(bySessionId?.id).toBe(TASK_ID)
  })

  test("#given a task archived by another manager instance in the same process #when a fresh instance looks up the session ID #then the registered task is returned", async () => {
    // given
    const firstManager = createBackgroundManager()
    const task = await trackTrackedTask(firstManager)
    completeTask(task)
    cast<{ removeTask: (task: BackgroundTask) => void }>(firstManager).removeTask(task)
    firstManager.shutdown()

    // when
    const bySessionId = manager.getTaskBySessionId(SESSION_ID)
    const byBgId = manager.getTask(TASK_ID)

    // then
    expect(bySessionId?.id).toBe(TASK_ID)
    expect(byBgId?.id).toBe(TASK_ID)
  })

  test("#given no task for the session #when looked up by session ID #then undefined is returned", async () => {
    // given
    await trackTrackedTask(manager)

    // when
    const found = manager.getTaskBySessionId("ses-never-registered")

    // then
    expect(found).toBeUndefined()
  })
})
