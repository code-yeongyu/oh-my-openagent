import { describe, expect, test } from "bun:test"

import { createOrGetSession } from "./session-creator"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"
import {
  _resetMemCacheForTesting,
  writeProviderModelsCache,
} from "../../shared/connected-providers-cache"

describe("call-omo-agent createOrGetSession", () => {
  test("creates detached session for small-context models", async () => {
    // given
    _resetForTesting()
    writeProviderModelsCache({
      connected: ["ollama"],
      models: {
        ollama: [{ id: "qwen2.5:14b", context: 16_384 }],
      },
    })

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
      agent: "sisyphus",
      abort: new AbortController().signal,
    }

    const args = {
      description: "test",
      prompt: "hello",
      subagent_type: "explore",
      run_in_background: true,
    }

    // when
    await createOrGetSession(args as never, toolContext as never, ctx as never, {
      providerID: "ollama",
      modelID: "qwen2.5:14b",
    })

    // then
    const createBody = (createCalls[0] as { body?: Record<string, unknown> })?.body
    expect(createBody).toEqual({
      title: "test (@explore subagent)",
    })

    _resetMemCacheForTesting()
  })

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
      agent: "sisyphus",
      abort: new AbortController().signal,
    }

    const args = {
      description: "test",
      prompt: "hello",
      subagent_type: "explore",
      run_in_background: true,
    }

    // when
    const result = await createOrGetSession(args as any, toolContext as any, ctx as any)

    // then
    expect(result).toEqual({ sessionID: "ses_child", isNew: true })
    expect(createCalls).toHaveLength(1)
    const createBody = (createCalls[0] as any)?.body
    expect(createBody?.parentID).toBe("ses_parent")
    expect(createBody?.permission).toBeUndefined()
    expect(subagentSessions.has("ses_child")).toBe(true)

    _resetMemCacheForTesting()
  })
})
