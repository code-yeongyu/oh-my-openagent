/// <reference types="bun-types" />

import { describe, test, expect, mock } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createManagerWithStatus(statusImpl: () => Promise<{ data: Record<string, { type: string }> }>): BackgroundManager {
  const client = {
    session: {
      status: statusImpl,
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  }

  return new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
}

describe("BackgroundManager polling overlap", () => {
  test("skips overlapping pollRunningTasks executions", async () => {
    //#given
    let activeCalls = 0
    let maxActiveCalls = 0
    let statusCallCount = 0
    let releaseStatus: (() => void) | undefined
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve
    })

    const manager = createManagerWithStatus(async () => {
      statusCallCount += 1
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await statusGate
      activeCalls -= 1
      return { data: {} }
    })

    //#when
    const firstPoll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    await Promise.resolve()
    const secondPoll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    releaseStatus?.()
    await Promise.all([firstPoll, secondPoll])
    manager.shutdown()

    //#then
    expect(maxActiveCalls).toBe(1)
    expect(statusCallCount).toBe(1)
  })
})


function createRunningTask(sessionID: string): BackgroundTask {
  return {
    id: `bg_test_${sessionID}`,
    sessionID,
    parentSessionID: "parent-session",
    parentMessageID: "parent-msg",
    description: "test task",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  const tasks = (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
  tasks.set(task.id, task)
}

function createManagerWithClient(clientOverrides: Record<string, unknown> = {}): BackgroundManager {
  const client = {
    session: {
      status: async () => ({ data: {} }),
      get: async () => ({ data: { id: "ses-default" } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({
        data: [{
          info: { role: "assistant", finish: "end_turn", id: "msg-2" },
          parts: [{ type: "text", text: "done" }],
        }, {
          info: { role: "user", id: "msg-1" },
          parts: [{ type: "text", text: "go" }],
        }],
      }),
      ...clientOverrides,
    },
  }
  return new BackgroundManager(
    { client, directory: tmpdir() } as unknown as PluginInput,
    undefined,
    { enableParentSessionNotifications: false },
  )
}

describe("BackgroundManager verifySessionExists", () => {
  describe("#given session.get reports a not-found response", () => {
    test("#when verifySessionExists runs #then it returns false", async () => {
      //#given
      const manager = createManagerWithClient({
        get: async () => ({
          error: { message: "Session not found", status: 404 },
          data: undefined,
        }),
      })

      //#when
      const result = await manager["verifySessionExists"]("ses-missing")
      await manager.shutdown()

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given session.get reports a transient transport error", () => {
    test("#when verifySessionExists runs #then it returns true", async () => {
      //#given
      const manager = createManagerWithClient({
        get: async () => ({
          error: { message: "Network timeout", status: 500 },
          data: undefined,
        }),
      })

      //#when
      const result = await manager["verifySessionExists"]("ses-transient")
      await manager.shutdown()

      //#then
      expect(result).toBe(true)
    })
  })
})

describe("BackgroundManager pollRunningTasks", () => {
  describe("#given a running task whose session is no longer in status response", () => {
    test("#when pollRunningTasks runs #then completes the task instead of leaving it running", async () => {
      //#given
      const manager = createManagerWithClient()
      const task = createRunningTask("ses-gone")
      injectTask(manager, task)

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })

    test("#when the first missing-status poll has no output #then it does not fail the task yet", async () => {
      //#given
      const getSession = mock(async () => ({
        error: { message: "Session not found", status: 404 },
        data: undefined,
      }))
      const manager = createManagerWithClient({
        get: getSession,
        messages: async () => ({ data: [] }),
      })
      const task = createRunningTask("ses-first-miss")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      await manager.shutdown()

      //#then
      expect(task.status).toBe("running")
      expect(task.error).toBeUndefined()
      expect(task.consecutiveMissedPolls).toBe(1)
      expect(getSession).not.toHaveBeenCalled()
    })
  })

  describe("#given a running task whose session status is idle", () => {
    test("#when pollRunningTasks runs #then completes the task", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle": { type: "idle" } } }),
      })
      const task = createRunningTask("ses-idle")
      injectTask(manager, task)

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
    })

    test("#when output was already observed from events #then it completes without fetching messages", async () => {
      //#given
      let messagesCallCount = 0
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle-cached": { type: "idle" } } }),
        messages: async () => {
          messagesCallCount += 1
          return {
            data: [{
              info: { role: "assistant", finish: "end_turn", id: "msg-2" },
              parts: [{ type: "text", text: "done" }],
            }],
          }
        },
      })
      const task = createRunningTask("ses-idle-cached")
      injectTask(manager, task)

      manager.handleEvent({
        type: "message.part.updated",
        properties: { sessionID: "ses-idle-cached", type: "text" },
      })

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(messagesCallCount).toBe(0)
    })

    test("#when todo state was already observed from events #then it completes without fetching todos", async () => {
      //#given
      let todoCallCount = 0
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle-todo-cached": { type: "idle" } } }),
        todo: async () => {
          todoCallCount += 1
          return { data: [] }
        },
      })
      const task = createRunningTask("ses-idle-todo-cached")
      injectTask(manager, task)

      manager.handleEvent({
        type: "message.part.updated",
        properties: { sessionID: "ses-idle-todo-cached", type: "text" },
      })
      manager.handleEvent({
        type: "todo.updated",
        properties: {
          sessionID: "ses-idle-todo-cached",
          todos: [
            { id: "todo-1", content: "done", status: "completed", priority: "high" },
          ],
        },
      })

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(todoCallCount).toBe(0)
    })
  })

  describe("#given a running task whose session status is busy", () => {
    test("#when pollRunningTasks runs #then keeps the task running", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-busy": { type: "busy" } } }),
      })
      const task = createRunningTask("ses-busy")
      injectTask(manager, task)

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("running")
    })
  })

  describe("#given a running task whose session has terminal non-idle status", () => {
    test('#when session status is "interrupted" #then completes the task', async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-interrupted": { type: "interrupted" } } }),
      })
      const task = createRunningTask("ses-interrupted")
      injectTask(manager, task)

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })

    test('#when session status is an unknown type #then completes the task', async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-unknown": { type: "some-weird-status" } } }),
      })
      const task = createRunningTask("ses-unknown")
      injectTask(manager, task)

      //#when
      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })
  })
})
