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
    expect(result).toEqual({ ok: true, sessionID: "ses_child", parentDirectory: "/parent" })
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body).toMatchObject({
      parentID: "ses_parent",
      title: "test task (@explore subagent)",
      permission: expect.arrayContaining([
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "task", action: "deny", pattern: "*" },
        { permission: "call_omo_agent", action: "deny", pattern: "*" },
      ]),
    })
  })

  test("creates child session with category tool permission rules", async () => {
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
      agentToUse: "sisyphus-junior",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4-mini" },
      categoryTools: { grep: false, glob: true, apply_patch: true },
    })

    // then
    expect(result.ok).toBe(true)
    expect(createCalls[0]?.body).toMatchObject({
      parentID: "ses_parent",
      title: "test task (@sisyphus-junior subagent)",
      permission: expect.arrayContaining([
        { permission: "grep", action: "deny", pattern: "*" },
        { permission: "glob", action: "allow", pattern: "*" },
        { permission: "apply_patch", action: "deny", pattern: "*" },
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "task", action: "deny", pattern: "*" },
      ]),
    })
  })
})
