/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

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

describe("BackgroundManager poll terminal ordering", () => {
  describe("#given an idle task before a terminal task", () => {
    test("#when polling completes both #then teardown keeps task iteration order", async () => {
      //#given
      const abortedSessions: string[] = []
      const directory = tmpdir()
      const client = {
        session: {
          status: async () => ({ data: { "ses-idle": { type: "idle" }, "ses-terminal": { type: "interrupted" } } }),
          get: async () => ({ data: { id: "ses-default" } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async (input: { path: { id: string } }) => {
            abortedSessions.push(input.path.id)
            return {}
          },
          todo: async () => ({ data: [] }),
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
      const manager = new BackgroundManager({ pluginContext, enableParentSessionNotifications: false })
      for (const task of [createTask("ses-idle"), createTask("ses-terminal")]) {
        manager["tasks"].set(task.id, task)
      }

      try {
        //#when
        await manager["pollRunningTasks"]()

        //#then
        expect(abortedSessions).toEqual(["ses-idle", "ses-terminal"])
      } finally {
        await manager.shutdown()
      }
    })
  })
})
