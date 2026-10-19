/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { MIN_IDLE_TIME_MS } from "./constants"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const SESSION_ID = "ses-escalated-child"

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

// A child that stopped on purpose: its last turn is an escalation and its todo list still has open items.
function createManager(todoContinuationEnabled?: boolean): { manager: BackgroundManager; notified: string[] } {
  const client = {
    session: {
      status: async () => ({ data: { [SESSION_ID]: { type: "idle" } } }),
      get: async () => ({ data: { id: SESSION_ID } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({
        data: [
          { content: "inspect the lane", status: "in_progress", priority: "high" },
          { content: "implement the fix", status: "pending", priority: "high" },
        ],
      }),
      messages: async () => ({
        data: [
          { info: { role: "user", id: "msg-1" }, parts: [{ type: "text", text: "fix it" }] },
          {
            info: { role: "assistant", finish: "end_turn", id: "msg-2" },
            parts: [{ type: "text", text: "ESCALATE: deep-high\n\nThe fix depends on a decision only the owner can make." }],
          },
        ],
      }),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: createPluginContext(client),
    enableParentSessionNotifications: false,
    ...(todoContinuationEnabled === undefined ? {} : { todoContinuationEnabled }),
  })
  const notified: string[] = []
  ;(manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession = async (task) => {
    notified.push(task.id)
  }
  return { manager, notified }
}

function createRunningTask(): BackgroundTask {
  return {
    id: "bg_escalated_child",
    sessionId: SESSION_ID,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "child that escalates",
    prompt: "fix it",
    agent: "sisyphus-junior",
    status: "running",
    startedAt: new Date(Date.now() - (MIN_IDLE_TIME_MS + 10)),
    progress: { toolCalls: 3, lastUpdate: new Date() },
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("BackgroundManager completion with incomplete todos", () => {
  describe("#given todo-continuation is disabled", () => {
    test("#when the child session goes idle #then the task completes and the parent is notified", async () => {
      //#given
      const { manager, notified } = createManager(false)
      const task = createRunningTask()
      manager["tasks"].set(task.id, task)

      //#when
      manager.handleEvent({ type: "session.idle", properties: { sessionID: SESSION_ID } })
      await waitUntil(() => notified.length > 0)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(notified).toEqual([task.id])
    })

    test("#when polling finds the child idle #then the task completes", async () => {
      //#given
      const { manager } = createManager(false)
      const task = createRunningTask()
      manager["tasks"].set(task.id, task)

      //#when
      await manager["pollRunningTasks"]()
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
    })
  })

  describe("#given todo-continuation is enabled (default)", () => {
    test("#when polling finds the child idle #then the task keeps waiting for the continuation", async () => {
      //#given
      const { manager, notified } = createManager()
      const task = createRunningTask()
      manager["tasks"].set(task.id, task)

      //#when
      await manager["pollRunningTasks"]()
      manager.shutdown()

      //#then
      expect(task.status).toBe("running")
      expect(notified).toEqual([])
    })
  })
})
