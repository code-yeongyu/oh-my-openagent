/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const ASSISTANT_OUTPUT = {
  data: [{
    info: { role: "assistant", finish: "end_turn", id: "msg-2" },
    parts: [{ type: "text", text: "done" }],
  }],
}

function createManager(sessionOverrides: Record<string, unknown> = {}): BackgroundManager {
  const directory = tmpdir()
  const client = {
    session: {
      status: async () => ({ data: {} }),
      get: async () => ({ data: { id: "ses-default" } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ASSISTANT_OUTPUT,
      ...sessionOverrides,
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

function createTask(sessionId: string, status: BackgroundTask["status"] = "running"): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "test task",
    prompt: "test",
    agent: "explore",
    status,
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  manager["tasks"].set(task.id, task)
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve: () => resolve?.() }
}

describe("BackgroundManager poll probe guards", () => {
  describe("#given a task re-bound to a new session while an old output probe is pending", () => {
    test("#when polling resumes #then the old probe cannot complete the new session", async () => {
      //#given
      const outputGate = createDeferred()
      const outputStarted = createDeferred()
      const manager = createManager({
        status: async () => ({ data: { "ses-old": { type: "idle" } } }),
        messages: async () => {
          outputStarted.resolve()
          await outputGate.promise
          return ASSISTANT_OUTPUT
        },
      })
      const task = createTask("ses-old")
      injectTask(manager, task)

      try {
        //#when
        const poll = manager["pollRunningTasks"]()
        await outputStarted.promise
        const restartedAt = new Date()
        task.sessionId = "ses-new"
        task.currentAttemptID = "att-new"
        task.attempts = [{
          attemptId: "att-new",
          attemptNumber: 2,
          sessionId: "ses-new",
          status: "running",
          startedAt: restartedAt,
        }]
        task.startedAt = restartedAt
        outputGate.resolve()
        await poll

        //#then
        expect(task.status).toBe("running")
      } finally {
        outputGate.resolve()
        await manager.shutdown()
      }
    })
  })

  describe("#given an empty todo probe followed by a todo.updated event", () => {
    test("#when an earlier task completes #then the newer incomplete todo observation blocks completion", async () => {
      //#given
      let abortCount = 0
      const manager = createManager({
        status: async () => ({ data: { "ses-first": { type: "idle" }, "ses-second": { type: "idle" } } }),
        abort: async () => {
          abortCount += 1
          if (abortCount === 1) {
            manager.handleEvent({
              type: "todo.updated",
              properties: { sessionID: "ses-second", todos: [{ status: "in_progress" }] },
            })
          }
          return {}
        },
      })
      const first = createTask("ses-first")
      const second = createTask("ses-second")
      injectTask(manager, first)
      injectTask(manager, second)

      try {
        //#when
        await manager["pollRunningTasks"]()

        //#then
        expect(second.status).toBe("running")
      } finally {
        await manager.shutdown()
      }
    })
  })

  describe("#given shutdown clears tasks while a probe is pending", () => {
    test("#when the probe settles #then no detached task is completed", async () => {
      //#given
      const outputGate = createDeferred()
      const outputStarted = createDeferred()
      const manager = createManager({
        status: async () => ({ data: { "ses-held": { type: "idle" } } }),
        messages: async () => {
          outputStarted.resolve()
          await outputGate.promise
          return ASSISTANT_OUTPUT
        },
      })
      const task = createTask("ses-held")
      injectTask(manager, task)

      try {
        //#when
        const poll = manager["pollRunningTasks"]()
        await outputStarted.promise
        await manager.shutdown()
        outputGate.resolve()
        await poll

        //#then
        expect(task.status).toBe("running")
      } finally {
        outputGate.resolve()
        await manager.shutdown()
      }
    })
  })

})
