/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createRunningTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "test task",
    prompt: "test prompt",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function createManager(): BackgroundManager {
  const session = {
    get: async () => ({ data: { id: "session" } }),
    prompt: async () => ({}),
    promptAsync: async () => ({}),
    abort: async () => ({}),
    todo: async () => ({ data: [] }),
    messages: async () => ({ data: [] }),
  }
  return new BackgroundManager({
    pluginContext: { client: { session }, directory: tmpdir() } as PluginInput,
    enableParentSessionNotifications: false,
  })
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
}

describe("BackgroundManager.failWatchdogExhaustedTask", () => {
  test("#given a running background task session #when the watchdog exhausts with no fallback #then the task is failed and a parent notification is enqueued", async () => {
    // given
    const manager = createManager()
    const task = createRunningTask("ses-watchdog-bg-task")
    injectTask(manager, task)

    // when
    await manager.failWatchdogExhaustedTask("ses-watchdog-bg-task", {
      model: "openai/gpt-5.4-mini",
      agent: "sisyphus-junior",
    })

    // then
    expect(task.status).toBe("error")
    expect(task.error).toContain("watchdog")
    expect(manager.getPendingNotifications("parent-session").map((pending) => pending.id)).toContain(task.id)

    await manager.shutdown()
  })

  test("#given a session that is not a background task #when the watchdog exhausts #then it is a no-op and does not throw", async () => {
    // given
    const manager = createManager()
    const task = createRunningTask("ses-watchdog-bg-task")
    injectTask(manager, task)

    // when
    await manager.failWatchdogExhaustedTask("ses-not-a-task", { model: "openai/gpt-5.4-mini" })

    // then
    expect(task.status).toBe("running")
    expect(manager.getPendingNotifications("parent-session")).toHaveLength(0)

    await manager.shutdown()
  })
})
