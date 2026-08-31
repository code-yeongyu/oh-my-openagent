import { describe, expect, test } from "bun:test"

import { createSyncSession } from "./sync-session-creator"

describe("createSyncSession", () => {
  test("creates child session with question permission denied", async () => {
    // given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
    })

    // then
    expect(result).toEqual({ ok: true, sessionID: "ses_child", sessionDirectory: "/parent" })
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body).toEqual({
      parentID: "ses_parent",
      title: "test task (@explore subagent)",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
      ],
    })
    expect(createCalls[0]?.query).toEqual({ directory: "/parent" })
  })

  test("uses an explicit child directory instead of the parent directory", async () => {
    //#given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/base" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_explicit" } }
        },
      },
    }

    //#when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "explicit worktree",
      directory: "/worktree-a",
      defaultDirectory: "/fallback",
    })

    //#then
    expect(result).toEqual({ ok: true, sessionID: "ses_explicit", sessionDirectory: "/worktree-a" })
    expect(createCalls[0]?.query).toEqual({ directory: "/worktree-a" })
  })

  test("uses the plugin default when parent lookup has no directory", async () => {
    //#given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: {} }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_default" } }
        },
      },
    }

    //#when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "default worktree",
      defaultDirectory: "/fallback",
    })

    //#then
    expect(result).toEqual({ ok: true, sessionID: "ses_default", sessionDirectory: "/fallback" })
    expect(createCalls[0]?.query).toEqual({ directory: "/fallback" })
  })

  test("inherits a child parent's actual directory for nested delegation", async () => {
    //#given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/worktree-a" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_nested" } }
        },
      },
    }

    //#when
    await createSyncSession(client as never, {
      parentSessionID: "ses_worker_a",
      agentToUse: "explore",
      description: "nested work",
      defaultDirectory: "/base",
    })

    //#then
    expect(createCalls[0]?.query).toEqual({ directory: "/worktree-a" })
  })
})
