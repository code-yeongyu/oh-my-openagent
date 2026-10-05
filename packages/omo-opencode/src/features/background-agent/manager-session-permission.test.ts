import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import type { PluginInput } from "@opencode-ai/plugin"

import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("BackgroundManager session permission", () => {
  test("passes parent directory route when prompting the child session", async () => {
    // given
    const promptCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async (input: Record<string, unknown>) => {
          promptCalls.push(input)
          return {}
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent" })
  })

  test("passes query directory when loading the parent session", async () => {
    // given
    const getCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async (input: Record<string, unknown>) => {
          getCalls.push(input)
          return { data: { directory: "/parent" } }
        },
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const directory = tmpdir()
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory }) })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(getCalls).toHaveLength(2)
    expect(getCalls).toEqual([
      {
        path: { id: "ses_parent" },
        query: { directory },
      },
      {
        path: { id: "ses_parent" },
        query: { directory },
      },
    ])
  })

  test("passes explicit session permission rules to child session creation", async () => {
    // given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      sessionPermission: [
        { permission: "question", action: "deny", pattern: "*" },
      ],
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body).toEqual({
      parentID: "ses_parent",
      title: "Test task (@explore subagent)",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
      ],
    })
  })
})

describe("BackgroundManager child session directory", () => {
  function createRecordingClient() {
    const createCalls: Array<Record<string, unknown>> = []
    const promptCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
        promptAsync: async (input: Record<string, unknown>) => {
          promptCalls.push(input)
          return {}
        },
        abort: async () => ({}),
      },
    }
    return { client, createCalls, promptCalls }
  }

  test("uses input.cwd for the child session create and prompt directory", async () => {
    // given
    const { client, createCalls, promptCalls } = createRecordingClient()
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      cwd: "/parent-fix-1",
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.query).toEqual({ directory: "/parent-fix-1" })
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent-fix-1" })
  })

  test("falls back to the parent directory when cwd is absent", async () => {
    // given
    const { client, createCalls, promptCalls } = createRecordingClient()
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.query).toEqual({ directory: "/parent" })
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent" })
  })

  test("persists cwd on the task record", async () => {
    // given
    const { client } = createRecordingClient()
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    const task = await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      cwd: "/parent-fix-1",
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(task.cwd).toBe("/parent-fix-1")
  })

  test("resume prompts the continuation in the task cwd", async () => {
    // given
    const { client, promptCalls } = createRecordingClient()
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })
    const tasks = unsafeTestValue<{ tasks: Map<string, BackgroundTask> }>(manager).tasks
    tasks.set("bg_worktree", {
      id: "bg_worktree",
      sessionId: "ses_worktree",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      description: "Worktree member",
      prompt: "Do something",
      agent: "explore",
      status: "completed",
      cwd: "/parent-fix-1",
    })

    // when
    await manager.resume({
      sessionId: "ses_worktree",
      prompt: "continue",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent_2",
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent-fix-1" })
  })
})
