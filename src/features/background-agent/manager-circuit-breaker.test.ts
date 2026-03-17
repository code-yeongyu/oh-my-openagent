import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { tmpdir } from "node:os"
import type { BackgroundTaskConfig } from "../../config/schema"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createManager(config?: BackgroundTaskConfig): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }

  const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, config)
  const testManager = manager as unknown as {
    enqueueNotificationForParent: (sessionID: string, fn: () => Promise<void>) => Promise<void>
    notifyParentSession: (task: BackgroundTask) => Promise<void>
    tasks: Map<string, BackgroundTask>
  }

  testManager.enqueueNotificationForParent = async (_sessionID, fn) => {
    await fn()
  }
  testManager.notifyParentSession = async () => {}

  return manager
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

async function flushAsyncWork() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe("BackgroundManager circuit breaker", () => {
  describe("#given the same tool dominates the recent window", () => {
    test("#when tool events arrive #then the task is cancelled early", async () => {
      const manager = createManager({
        circuitBreaker: {
          windowSize: 20,
          repetitionThresholdPercent: 80,
        },
      })
      const task: BackgroundTask = {
        id: "task-loop-1",
        sessionID: "session-loop-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Looping task",
        prompt: "loop",
        agent: "explore",
        status: "running",
        startedAt: new Date(Date.now() - 60_000),
        progress: {
          toolCalls: 0,
          lastUpdate: new Date(Date.now() - 60_000),
        },
      }
      getTaskMap(manager).set(task.id, task)

      for (const toolName of [
        "read",
        "read",
        "grep",
        "read",
        "edit",
        "read",
        "read",
        "bash",
        "read",
        "read",
        "read",
        "glob",
        "read",
        "read",
        "read",
        "read",
        "read",
        "read",
        "read",
        "read",
      ]) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: { sessionID: task.sessionID, type: "tool", tool: toolName },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("cancelled")
      expect(task.error).toContain("repeatedly called read 16/20 times")
    })
  })

  describe("#given recent tool calls are diverse", () => {
    test("#when the window fills #then the task keeps running", async () => {
      const manager = createManager({
        circuitBreaker: {
          windowSize: 10,
          repetitionThresholdPercent: 80,
        },
      })
      const task: BackgroundTask = {
        id: "task-diverse-1",
        sessionID: "session-diverse-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Healthy task",
        prompt: "work",
        agent: "explore",
        status: "running",
        startedAt: new Date(Date.now() - 60_000),
        progress: {
          toolCalls: 0,
          lastUpdate: new Date(Date.now() - 60_000),
        },
      }
      getTaskMap(manager).set(task.id, task)

      for (const toolName of [
        "read",
        "grep",
        "edit",
        "bash",
        "glob",
        "read",
        "lsp_diagnostics",
        "grep",
        "edit",
        "read",
      ]) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: { sessionID: task.sessionID, type: "tool", tool: toolName },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("running")
      expect(task.progress?.toolCalls).toBe(10)
    })
  })

  describe("#given the absolute cap is configured lower than the repetition detector needs", () => {
    test("#when the raw tool-call cap is reached #then the backstop still cancels the task", async () => {
      const manager = createManager({
        maxToolCalls: 3,
        circuitBreaker: {
          windowSize: 10,
          repetitionThresholdPercent: 95,
        },
      })
      const task: BackgroundTask = {
        id: "task-cap-1",
        sessionID: "session-cap-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Backstop task",
        prompt: "work",
        agent: "explore",
        status: "running",
        startedAt: new Date(Date.now() - 60_000),
        progress: {
          toolCalls: 0,
          lastUpdate: new Date(Date.now() - 60_000),
        },
      }
      getTaskMap(manager).set(task.id, task)

      for (const toolName of ["read", "grep", "edit"]) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: { sessionID: task.sessionID, type: "tool", tool: toolName },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("cancelled")
      expect(task.error).toContain("maximum tool call limit (3)")
    })
  })

  describe("#given the same running tool part emits multiple updates", () => {
    test("#when duplicate running updates arrive #then it only counts the tool once", async () => {
      const manager = createManager({
        maxToolCalls: 2,
        circuitBreaker: {
          windowSize: 5,
          repetitionThresholdPercent: 80,
        },
      })
      const task: BackgroundTask = {
        id: "task-dedupe-1",
        sessionID: "session-dedupe-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Dedupe task",
        prompt: "work",
        agent: "explore",
        status: "running",
        startedAt: new Date(Date.now() - 60_000),
        progress: {
          toolCalls: 0,
          lastUpdate: new Date(Date.now() - 60_000),
        },
      }
      getTaskMap(manager).set(task.id, task)

      for (let index = 0; index < 3; index += 1) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "tool-1",
              sessionID: task.sessionID,
              type: "tool",
              tool: "bash",
              state: { status: "running" },
            },
          },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("running")
      expect(task.progress?.toolCalls).toBe(1)
      expect(task.progress?.countedToolPartIDs).toEqual(["tool-1"])
    })
  })
})
