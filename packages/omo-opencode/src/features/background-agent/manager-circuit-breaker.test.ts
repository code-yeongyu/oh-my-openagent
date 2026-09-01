/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { tmpdir } from "node:os"
import type { BackgroundTaskConfig } from "../../config/schema"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createManager(config?: BackgroundTaskConfig): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }

  const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }), config: config })
  const testManager = unsafeTestValue<{
    enqueueNotificationForParent: (sessionId: string, fn: () => Promise<void>) => Promise<void>
    notifyParentSession: (task: BackgroundTask) => Promise<void>
    tasks: Map<string, BackgroundTask>
  }>(manager)

  testManager.enqueueNotificationForParent = async (_sessionId: string, fn) => {
    await fn()
  }
  testManager.notifyParentSession = async () => {}

  return manager
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(manager)).tasks
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
        sessionId: "session-loop-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
          properties: { sessionID: task.sessionId, type: "tool", tool: "read" },
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
        sessionId: "session-diverse-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
          properties: { sessionID: task.sessionId, type: "tool", tool: toolName },
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
        sessionId: "session-cap-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
          properties: { sessionID: task.sessionId, type: "tool", tool: "read" },
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
        sessionId: "session-dedupe-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
              sessionID: task.sessionId,
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
        sessionId: "session-diff-files-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
              sessionID: task.sessionId,
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
        sessionId: "session-same-file-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
              sessionID: task.sessionId,
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

  describe("#given duplicate tool_use blocks arrive without state.input but with top-level input", () => {
    test("#when 20 identical reads arrive #then circuit breaker still detects the loop", async () => {
      // Regression for #3962: when a model (e.g. Kimi K2.6) generates duplicate
      // tool_use blocks faster than the tool actually starts running, the
      // updated events carry `input` on the part itself but `state.input`
      // stays null/undefined. Before the fix, the signature alternated
      // between "read::__unknown-input__" and "read::{filePath:...}" and the
      // consecutive counter kept resetting to 1, so the breaker never fired.
      const manager = createManager({
        circuitBreaker: {
          consecutiveThreshold: 20,
        },
      })
      const task: BackgroundTask = {
        id: "task-no-state-input-1",
        sessionId: "session-no-state-input-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
        description: "Duplicate tool_use blocks",
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
              sessionID: task.sessionId,
              type: "tool",
              tool: "read",
              input: { filePath: "/src/hooks/tool-pair-validator/hook.ts" },
            },
          },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("cancelled")
      expect(task.error).toContain("read 20 consecutive times")
    })

    test("#when state.input is present #then it takes precedence over top-level input", async () => {
      // Confirm the fallback order: state.input wins when both are present.
      const manager = createManager({
        circuitBreaker: {
          consecutiveThreshold: 20,
        },
      })
      const task: BackgroundTask = {
        id: "task-state-input-wins-1",
        sessionId: "session-state-input-wins-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
        description: "state.input precedence",
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

      // 20 distinct state.input.filePath values but identical top-level input.
      // If state.input takes precedence (correct), signatures differ and the
      // loop does NOT trigger. If we erroneously preferred top-level input,
      // signatures would all be identical and the breaker would fire.
      for (let i = 0; i < 20; i++) {
        manager.handleEvent({
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: task.sessionId,
              type: "tool",
              tool: "read",
              input: { filePath: "/src/same.ts" },
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
        sessionId: "session-disabled-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
            sessionID: task.sessionId,
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
        sessionId: "session-cap-disabled-1",
        parentSessionId: "parent-1",
        parentMessageId: "msg-1",
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
          properties: { sessionID: task.sessionId, type: "tool", tool: toolName },
        })
      }

      await flushAsyncWork()

      expect(task.status).toBe("cancelled")
      expect(task.error).toContain("maximum tool call limit (3)")
    })
  })
})
