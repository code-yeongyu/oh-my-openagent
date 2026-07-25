/// <reference types="bun-types" />

import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { afterEach, describe, expect, test } from "bun:test"
import { BackgroundManager } from "../../features/background-agent"
import { clearBackgroundTaskRegistryForTesting } from "../../features/background-agent/task-registry"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createBackgroundOutput } from "./create-background-output"

const parentSessionID = "ses_parent_recovery"
const childSessionID = "ses_child_recovery"
const taskID = "bg_durable_recovery"
const launchOutput = `Background task launched.

Background Task ID: ${taskID}
Description: durable recovery
Agent: explore
Status: running

<task_metadata>
session_id: ${childSessionID}
background_task_id: ${taskID}
subagent: explore
</task_metadata>`

function createClient(): PluginInput["client"] {
  return unsafeTestValue<PluginInput["client"]>({
    session: {
      messages: async ({ path }: { path: { id: string } }) => ({
        data: path.id === parentSessionID
          ? [{ info: { role: "assistant" }, parts: [{ type: "tool", state: { status: "completed", output: launchOutput, metadata: {} } }] }]
          : [{ id: "msg_child_result", info: { role: "assistant", time: "2026-07-25T00:00:00.000Z" }, parts: [{ type: "text", text: "durable result" }] }],
      }),
      promptAsync: async () => ({}),
      status: async () => ({ data: {} }),
    },
  })
}

function createToolContext(): ToolContext {
  return unsafeTestValue<ToolContext>({
    sessionID: parentSessionID,
    messageID: "msg_parent_recovery",
    agent: "sisyphus",
    directory: "/tmp/omo-patch/recovery-test",
    worktree: "/tmp/omo-patch/recovery-test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  })
}

afterEach(() => {
  clearBackgroundTaskRegistryForTesting()
})

describe("background task durable recovery", () => {
  test("#given an empty in-memory registry and a persisted launch #when background_output runs #then it resolves the child session", async () => {
    // given
    const client = createClient()
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client, directory: "/tmp/omo-patch/recovery-test" }),
    })
    const tool = createBackgroundOutput(manager, client)

    try {
      // when
      const output = await tool.execute({ task_id: taskID }, createToolContext())

      // then
      expect(output).toContain("durable result")
      expect(output).not.toContain("Task not found")
    } finally {
      await manager.shutdown()
    }
  })

  test("#given an empty in-memory registry and a persisted launch #when resume uses the child session id #then it continues the recovered task", async () => {
    // given
    const client = createClient()
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client, directory: "/tmp/omo-patch/recovery-test" }),
    })

    try {
      // when
      const task = await manager.resume({
        sessionId: childSessionID,
        prompt: "continue",
        parentSessionId: parentSessionID,
        parentMessageId: "msg_parent_recovery",
      })

      // then
      expect(task.id).toBe(taskID)
      expect(task.sessionId).toBe(childSessionID)
      expect(task.status).toBe("running")
    } finally {
      await manager.shutdown()
    }
  })
})
