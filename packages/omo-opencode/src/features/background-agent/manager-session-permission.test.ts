import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import type { PluginInput } from "@opencode-ai/plugin"

import { BackgroundManager } from "./manager"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("BackgroundManager session permission", () => {
  test("uses an explicit directory for child creation and prompt routing", async () => {
    //#given
    const createCalls: Array<Record<string, unknown>> = []
    const promptCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_explicit_child" } }
        },
        promptAsync: async (input: Record<string, unknown>) => {
          promptCalls.push(input)
          return {}
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    //#when
    await manager.launch({
      description: "Explicit directory",
      prompt: "Do something",
      agent: "explore",
      directory: "/worktree-a",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    manager.shutdown()

    //#then
    expect(createCalls[0]?.query).toEqual({ directory: "/worktree-a" })
    expect(promptCalls[0]?.query).toEqual({ directory: "/worktree-a" })
  })

  test("keeps concurrent sibling directories separate", async () => {
    //#given
    const createDirectories: string[] = []
    const promptDirectories: string[] = []
    let nextSession = 0
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: { query?: { directory?: string } }) => {
          createDirectories.push(input.query?.directory ?? "")
          nextSession += 1
          return { data: { id: `ses_sibling_${nextSession}` } }
        },
        promptAsync: async (input: { query?: { directory?: string } }) => {
          promptDirectories.push(input.query?.directory ?? "")
          return {}
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }) })

    //#when
    await Promise.all([
      manager.launch({
        description: "Sibling A",
        prompt: "Do A",
        agent: "explore-a",
        directory: "/worktree-a",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_a",
      }),
      manager.launch({
        description: "Sibling B",
        prompt: "Do B",
        agent: "explore-b",
        directory: "/worktree-b",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_b",
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 50))
    manager.shutdown()

    //#then
    expect(createDirectories.sort()).toEqual(["/worktree-a", "/worktree-b"])
    expect(promptDirectories.sort()).toEqual(["/worktree-a", "/worktree-b"])
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
