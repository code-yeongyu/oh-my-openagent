/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import type { PluginInput } from "@opencode-ai/plugin"

import { BackgroundManager } from "./manager"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("BackgroundManager session permission", () => {
  test("uses an explicit launch directory instead of the parent session directory", async () => {
    // given
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
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    await manager.launch({
      description: "Worktree task",
      prompt: "Do something",
      agent: "repository-reviewer",
      directory: "/member-worktree",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.query).toEqual({ directory: "/member-worktree" })
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/member-worktree" })
  })

  test("does not substitute general when an exact agent is absent at prompt time", async () => {
    // given
    const promptCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/member-worktree" } }),
        create: async () => ({ data: { id: "ses_exact_child" } }),
        promptAsync: async (input: Record<string, unknown>) => {
          promptCalls.push(input)
          throw new Error("Agent not found: repository-reviewer")
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    await manager.launch({
      description: "Exact project agent",
      prompt: "Review the repository",
      agent: "repository-reviewer",
      directory: "/member-worktree",
      exactAgent: true,
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    manager.shutdown()

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.body).toMatchObject({ agent: "repository-reviewer" })
  })

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

  test("persists the inherited parent directory on the background task", async () => {
    // given
    let markSessionCreated: (() => void) | undefined
    const sessionCreated = new Promise<void>((resolve) => {
      markSessionCreated = resolve
    })
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    // when
    const launchedTask = await manager.launch({
      description: "Inherited directory task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      onSessionCreated: () => markSessionCreated?.(),
    })
    await sessionCreated
    const persistedTask = manager.getTask(launchedTask.id)
    await manager.shutdown()

    // then
    expect(persistedTask?.directory).toBe("/parent")
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
