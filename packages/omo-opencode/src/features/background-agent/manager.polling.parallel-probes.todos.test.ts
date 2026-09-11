/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createManager(): BackgroundManager {
  const directory = tmpdir()
  const client = {
    session: {
      status: async () => ({ data: { "ses-done": { type: "idle" }, "ses-todos": { type: "idle" }, "ses-busy": { type: "busy" } } }),
      get: async () => ({ data: { id: "ses-default" } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async (args: { path?: { id?: string } }) => args.path?.id === "ses-todos"
        ? { data: [{ id: "t1", content: "still working", status: "in_progress", priority: "high" }] }
        : { data: [] },
      messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }] }),
    },
  }
  const pluginContext: PluginInput = {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: unsafeTestValue<PluginInput["$"]>({}),
    client: unsafeTestValue<PluginInput["client"]>(client),
  }
  return new BackgroundManager({ pluginContext, enableParentSessionNotifications: false })
}

function createTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "test task",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

describe("BackgroundManager polling todo gates", () => {
  describe("#given idle tasks with and without open todos and one active task", () => {
    test("#when polling runs #then only the idle task without open todos completes", async () => {
      //#given
      const manager = createManager()
      const done = createTask("ses-done")
      const withTodos = createTask("ses-todos")
      const busy = createTask("ses-busy")
      for (const task of [done, withTodos, busy]) {
        manager["tasks"].set(task.id, task)
      }

      try {
        //#when
        await manager["pollRunningTasks"]()

        //#then
        expect(done.status).toBe("completed")
        expect(withTodos.status).toBe("running")
        expect(busy.status).toBe("running")
      } finally {
        await manager.shutdown()
      }
    })
  })
})
