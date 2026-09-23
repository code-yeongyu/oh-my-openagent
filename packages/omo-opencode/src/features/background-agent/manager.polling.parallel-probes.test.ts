/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_SESSION_GONE_POLLS } from "./session-existence"
import type { BackgroundTask } from "./types"

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: {
      id: "test-project",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

function createManager(sessionOverrides: Record<string, unknown>): BackgroundManager {
  const client = {
    session: {
      status: async () => ({ data: {} }),
      get: async () => ({ data: { id: "ses-default" } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
      ...sessionOverrides,
    },
  }
  return new BackgroundManager({
    pluginContext: createPluginContext(client),
    config: undefined,
    enableParentSessionNotifications: false,
  })
}

function createRunningTask(sessionId: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "test task",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
    ...overrides,
  }
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  manager["tasks"].set(task.id, task)
}

describe("BackgroundManager poll probe fan-out", () => {
  describe("#given a task whose session vanished from status after the missed-poll threshold", () => {
    test("#when pollRunningTasks runs #then the crashed-session path still marks the task as error", async () => {
      //#given
      const manager = createManager({
        status: async () => ({ data: {} }),
        messages: async () => ({ data: [] }),
        get: async () => ({
          error: { message: "Session not found", status: 404 },
          data: undefined,
        }),
      })
      const task = createRunningTask("ses-gone", {
        consecutiveMissedPolls: MIN_SESSION_GONE_POLLS,
      })
      injectTask(manager, task)

      try {
        //#when
        await manager["pollRunningTasks"]()

        //#then
        expect(task.status).toBe("error")
        expect(task.error).toContain("no longer exists")
      } finally {
        await manager.shutdown()
      }
    })
  })

  describe("#given an idle task whose messages endpoint rejects", () => {
    test("#when pollRunningTasks runs #then the upstream fail-open contract still completes it", async () => {
      //#given
      const manager = createManager({
        status: async () => ({ data: { "ses-broken": { type: "idle" } } }),
        messages: async () => {
          throw new Error("messages endpoint exploded")
        },
      })
      const broken = createRunningTask("ses-broken")
      injectTask(manager, broken)

      try {
        //#when
        await manager["pollRunningTasks"]()

        //#then
        expect(broken.status).toBe("completed")
      } finally {
        await manager.shutdown()
      }
    })
  })
})
