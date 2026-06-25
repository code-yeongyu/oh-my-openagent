const { describe, test, expect, mock } = require("bun:test")

import type { PluginInput } from "@opencode-ai/plugin"

describe("executeSync", () => {
  test("passes question=false via tools parameter to block question tool", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
    }

    let promptArgs: { body: { tools: Record<string, boolean> } }
    const promptAsync = mock(async (input: { body: { tools: Record<string, boolean> } }) => {
      promptArgs = input
      return { data: {} }
    })

    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-1",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as unknown as PluginInput, deps)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.question).toBe(false)
  })

  test("passes task=false via tools parameter", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
    }

    let promptArgs: { body: { tools: Record<string, boolean> } }
    const promptAsync = mock(async (input: { body: { tools: Record<string, boolean> } }) => {
      promptArgs = input
      return { data: {} }
    })

    const args = {
      subagent_type: "librarian",
      description: "search docs",
      prompt: "find docs",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-2",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as unknown as PluginInput, deps)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.task).toBe(false)
  })
})
