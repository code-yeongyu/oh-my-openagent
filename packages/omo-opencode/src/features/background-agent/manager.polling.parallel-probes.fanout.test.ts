/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import { MAX_POLL_PROBE_CONCURRENCY } from "./poll-session-probes"
import type { BackgroundTask } from "./types"

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve: () => resolve?.() }
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

describe("BackgroundManager poll probe fan-out", () => {
  describe("#given five idle sessions", () => {
    test("#when output and todo probes wait #then each fan-out reaches the bounded cap", async () => {
      //#given
      const sessionIDs = ["ses-1", "ses-2", "ses-3", "ses-4", "ses-5"]
      const gate = createDeferred()
      const outputStarted = createDeferred()
      let outputCalls = 0
      let outputInFlight = 0
      let todoInFlight = 0
      let maxOutputInFlight = 0
      let maxTodoInFlight = 0
      const directory = tmpdir()
      const client = {
        session: {
          status: async () => ({ data: Object.fromEntries(sessionIDs.map((id) => [id, { type: "idle" }])) }),
          get: async () => ({ data: { id: "ses-default" } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          messages: async () => {
            outputCalls += 1
            outputInFlight += 1
            maxOutputInFlight = Math.max(maxOutputInFlight, outputInFlight)
            if (outputCalls === sessionIDs.length) {
              outputStarted.resolve()
            }
            await gate.promise
            outputInFlight -= 1
            return { data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }] }
          },
          todo: async () => {
            todoInFlight += 1
            maxTodoInFlight = Math.max(maxTodoInFlight, todoInFlight)
            await gate.promise
            todoInFlight -= 1
            return { data: [] }
          },
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
      const manager = new BackgroundManager({ pluginContext, enableParentSessionNotifications: false })
      const tasks = sessionIDs.map(createTask)
      for (const task of tasks) {
        manager["tasks"].set(task.id, task)
      }

      try {
        //#when
        const poll = manager["pollRunningTasks"]()
        await outputStarted.promise
        gate.resolve()
        await poll

        //#then
        expect(maxOutputInFlight).toBe(Math.min(sessionIDs.length, MAX_POLL_PROBE_CONCURRENCY))
        expect(maxTodoInFlight).toBe(Math.min(sessionIDs.length, MAX_POLL_PROBE_CONCURRENCY))
        for (const task of tasks) {
          expect(task.status).toBe("completed")
        }
      } finally {
        gate.resolve()
        await manager.shutdown()
      }
    })
  })
})
