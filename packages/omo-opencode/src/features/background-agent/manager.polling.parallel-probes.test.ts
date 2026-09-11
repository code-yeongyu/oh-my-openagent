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

function createOverlapRecorder(): { track: () => Promise<void>, calls: number, maxInFlight: number } {
  const recorder = {
    calls: 0,
    maxInFlight: 0,
    inFlight: 0,
    async track(): Promise<void> {
      recorder.calls += 1
      recorder.inFlight += 1
      recorder.maxInFlight = Math.max(recorder.maxInFlight, recorder.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      recorder.inFlight -= 1
    },
  }
  return recorder
}

const ASSISTANT_OUTPUT = {
  data: [{
    info: { role: "assistant", finish: "end_turn", id: "msg-2" },
    parts: [{ type: "text", text: "done" }],
  }, {
    info: { role: "user", id: "msg-1" },
    parts: [{ type: "text", text: "go" }],
  }],
}

describe("BackgroundManager poll probe fan-out", () => {
  describe("#given five running tasks whose sessions all report idle in one tick", () => {
    test("#when pollRunningTasks runs #then every output probe overlaps and every task completes", async () => {
      //#given
      const sessionIDs = ["ses-1", "ses-2", "ses-3", "ses-4", "ses-5"]
      const outputRecorder = createOverlapRecorder()
      const todoRecorder = createOverlapRecorder()
      const manager = createManager({
        status: async () => ({
          data: Object.fromEntries(sessionIDs.map((id) => [id, { type: "idle" }])),
        }),
        messages: async () => {
          await outputRecorder.track()
          return ASSISTANT_OUTPUT
        },
        todo: async () => {
          await todoRecorder.track()
          return { data: [] }
        },
      })
      const tasks = sessionIDs.map((id) => createRunningTask(id))
      for (const task of tasks) injectTask(manager, task)

      //#when
      await manager["pollRunningTasks"]()
      manager.shutdown()

      //#then
      expect(outputRecorder.calls).toBe(sessionIDs.length)
      expect(outputRecorder.maxInFlight).toBe(sessionIDs.length)
      expect(todoRecorder.calls).toBe(sessionIDs.length)
      expect(todoRecorder.maxInFlight).toBe(sessionIDs.length)
      for (const task of tasks) {
        expect(task.status).toBe("completed")
      }
    })
  })

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

      //#when
      await manager["pollRunningTasks"]()
      manager.shutdown()

      //#then
      expect(task.status).toBe("error")
      expect(task.error).toContain("no longer exists")
    })
  })

  describe("#given one idle task with open todos, one idle task without, and one busy task", () => {
    test("#when pollRunningTasks runs #then only the idle task without open todos completes", async () => {
      //#given
      const manager = createManager({
        status: async () => ({
          data: {
            "ses-done": { type: "idle" },
            "ses-todos": { type: "idle" },
            "ses-busy": { type: "busy" },
          },
        }),
        messages: async () => ASSISTANT_OUTPUT,
        todo: async (args: { path?: { id?: string } }) => {
          if (args?.path?.id === "ses-todos") {
            return { data: [{ id: "t1", content: "still working", status: "in_progress", priority: "high" }] }
          }
          return { data: [] }
        },
      })
      const done = createRunningTask("ses-done")
      const withTodos = createRunningTask("ses-todos")
      const busy = createRunningTask("ses-busy")
      for (const task of [done, withTodos, busy]) injectTask(manager, task)

      //#when
      await manager["pollRunningTasks"]()
      manager.shutdown()

      //#then
      expect(done.status).toBe("completed")
      expect(withTodos.status).toBe("running")
      expect(busy.status).toBe("running")
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

      //#when
      await manager["pollRunningTasks"]()
      manager.shutdown()

      //#then
      expect(broken.status).toBe("completed")
    })
  })
})
