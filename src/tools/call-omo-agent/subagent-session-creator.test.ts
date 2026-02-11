import { describe, expect, test } from "bun:test"

import { resolveOrCreateSessionId } from "./subagent-session-creator"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"

describe("call-omo-agent resolveOrCreateSessionId", () => {
  test("tracks newly created child session as subagent session", async () => {
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
            return { data: { id: "ses_child_sync" } }
          },
        },
      },
    }

    const args = {
      description: "sync test",
      prompt: "hello",
      subagent_type: "explore",
      run_in_background: false,
    }

    const toolContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: new AbortController().signal,
    }

    // when
    const result = await resolveOrCreateSessionId(ctx as any, args as any, toolContext as any)

    // then
    expect(result).toEqual({ ok: true, sessionID: "ses_child_sync" })
    expect(createCalls).toHaveLength(1)
    expect(subagentSessions.has("ses_child_sync")).toBe(true)
  })
})
