import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import type { PluginInput } from "@opencode-ai/plugin"

import { BackgroundManager } from "./manager"

describe("BackgroundManager session permission", () => {
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
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
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
