/// <reference types="bun-types" />

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
  describe("#given flat-format tool events have no state.input", () => {
    test("#when 20 consecutive read events arrive #then the task keeps running", async () => {
      const manager = createManager({
        circuitBreaker: {
          consecutiveThreshold: 20,
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

      for (let i = 0; i < 20; i++) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: { sessionID: task.sessionID, type: "tool", tool: "read" },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("running")
      expect(task.progress?.toolCalls).toBe(20)
    })
  })

  describe("#given recent tool calls are diverse", () => {
    test("#when the window fills #then the task keeps running", async () => {
      const manager = createManager({
        circuitBreaker: {
          consecutiveThreshold: 10,
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
    test("#when repeated flat-format tool events reach maxToolCalls #then the backstop still cancels the task", async () => {
      const manager = createManager({
        maxToolCalls: 3,
        circuitBreaker: {
          consecutiveThreshold: 95,
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

      for (let i = 0; i < 3; i++) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: { sessionID: task.sessionID, type: "tool", tool: "read" },
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
          consecutiveThreshold: 5,
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
      expect(task.progress?.countedToolPartIDs).toEqual(new Set(["tool-1"]))
    })
  })

  describe("#given same tool reading different files", () => {
    test("#when tool events arrive with state.input #then task keeps running", async () => {
      const manager = createManager({
        circuitBreaker: {
          consecutiveThreshold: 20,
        },
      })
      const task: BackgroundTask = {
        id: "task-diff-files-1",
        sessionID: "session-diff-files-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Reading different files",
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

      for (let i = 0; i < 20; i++) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: task.sessionID,
              type: "tool",
              tool: "read",
              state: { status: "running", input: { filePath: `/src/file-${i}.ts` } },
            },
          },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("running")
      expect(task.progress?.toolCalls).toBe(20)
    })
  })

  describe("#given same tool reading same file repeatedly", () => {
    test("#when tool events arrive with state.input #then task is cancelled with bare tool name in error", async () => {
      const manager = createManager({
        circuitBreaker: {
          consecutiveThreshold: 20,
        },
      })
      const task: BackgroundTask = {
        id: "task-same-file-1",
        sessionID: "session-same-file-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Reading same file repeatedly",
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

      for (let i = 0; i < 20; i++) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: task.sessionID,
              type: "tool",
              tool: "read",
              state: { status: "running", input: { filePath: "/src/same.ts" } },
            },
          },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("cancelled")
      expect(task.error).toContain("read 20 consecutive times")
      expect(task.error).not.toContain("::")
    })
  })

  describe("#given circuit breaker enabled is false", () => {
    test("#when repetitive tools arrive #then task keeps running", async () => {
      const manager = createManager({
        circuitBreaker: {
          enabled: false,
          consecutiveThreshold: 20,
        },
      })
      const task: BackgroundTask = {
        id: "task-disabled-1",
        sessionID: "session-disabled-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Disabled circuit breaker task",
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

      for (let i = 0; i < 20; i++) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: {
            sessionID: task.sessionID,
            type: "tool",
            tool: "read",
          },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("running")
    })
  })

  describe("#given circuit breaker enabled is false but absolute cap is low", () => {
    test("#when max tool calls exceeded #then task is still cancelled by absolute cap", async () => {
      const manager = createManager({
        maxToolCalls: 3,
        circuitBreaker: {
          enabled: false,
          consecutiveThreshold: 95,
        },
      })
      const task: BackgroundTask = {
        id: "task-cap-disabled-1",
        sessionID: "session-cap-disabled-1",
        parentSessionID: "parent-1",
        parentMessageID: "msg-1",
        description: "Backstop task with disabled circuit breaker",
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
})
