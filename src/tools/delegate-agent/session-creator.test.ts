import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"
import { createOrGetSession } from "./session-creator"

describe("delegate-agent createOrGetSession", () => {
  test("creates child session without overriding permission and tracks it as subagent session", async () => {
    // given
    _resetForTesting()

    const createCalls: Array<unknown> = []
    const ctx = {
      directory: "/project",
      client: {
        session: {
          get: async () => ({ data: { directory: "/parent" } }),
          create: async (args: unknown) => {
            createCalls.push(args)
            return { data: { id: "ses_child" } }
          },
        },
      },
    }

    const toolContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
    }

    const args = {
      description: "test",
      prompt: "hello",
      subagent_type: "trinity",
      run_in_background: true,
    }

    // when
    const result = await createOrGetSession(args, toolContext, ctx as unknown as PluginInput)

    // then
    expect(result).toEqual({ sessionID: "ses_child", isNew: true })
    expect(createCalls).toHaveLength(1)
    const createBody = (createCalls[0] as { body?: Record<string, unknown> })?.body
    expect(createBody?.parentID).toBe("ses_parent")
    expect(createBody?.permission).toBeUndefined()
    expect(subagentSessions.has("ses_child")).toBe(true)
  })
})
