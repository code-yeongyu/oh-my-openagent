import { describe, expect, test } from "bun:test"

import type { RuntimeFallbackPluginInput } from "./types"
import { resolvePersistedSilentCleanStop } from "./silent-clean-stop"

const SESSION_ID = "session-silent-clean-stop"

function createAssistantInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "message-silent-clean-stop",
    sessionID: SESSION_ID,
    role: "assistant",
    finish: "unknown",
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  }
}

function createMessage(
  info: Record<string, unknown>,
  parts: unknown[] = [{ type: "step-start" }, { type: "step-finish", reason: "unknown" }],
): Record<string, unknown> {
  return { info, parts }
}

function createContext(messagesResponse: unknown): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => messagesResponse,
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

describe("resolvePersistedSilentCleanStop", () => {
  test("#given the final persisted assistant is error-free unknown zero-token step metadata #when classified #then it is a silent clean stop", async () => {
    // given
    const ctx = createContext({
      data: [
        createMessage({ id: "message-user", sessionID: SESSION_ID, role: "user" }, [
          { type: "text", text: "continue" },
        ]),
        createMessage(createAssistantInfo()),
      ],
    })

    // when
    const result = await resolvePersistedSilentCleanStop(ctx, SESSION_ID)

    // then
    expect(result).toEqual({ messageID: "message-silent-clean-stop" })
  })

  test("#given persisted history classification #when messages are queried #then only the final message is requested", async () => {
    // given
    let observedQuery: { directory: string; limit?: number } | undefined
    const ctx = createContext({ data: [createMessage(createAssistantInfo())] })
    ctx.client.session.messages = async (input) => {
      observedQuery = input.query
      return { data: [createMessage(createAssistantInfo())] }
    }

    // when
    await resolvePersistedSilentCleanStop(ctx, SESSION_ID)

    // then
    expect(observedQuery).toEqual({ directory: "/test/dir", limit: 1 })
  })

  test("#given output-bearing parts #when classified #then text reasoning and tool output are rejected", async () => {
    // given
    const outputParts = [
      { type: "text", text: "recovered" },
      { type: "reasoning", text: "working" },
      { type: "tool", tool: "read", state: { status: "completed" } },
    ]

    // when
    const results = await Promise.all(outputParts.map((outputPart) => resolvePersistedSilentCleanStop(
      createContext({ data: [createMessage(createAssistantInfo(), [{ type: "step-start" }, outputPart])] }),
      SESSION_ID,
    )))

    // then
    expect(results).toEqual([undefined, undefined, undefined])
  })

  test("#given an assistant error #when classified #then it is rejected", async () => {
    // given
    const ctx = createContext({
      data: [createMessage(createAssistantInfo({ error: { name: "ProviderError" } }))],
    })

    // when
    const result = await resolvePersistedSilentCleanStop(ctx, SESSION_ID)

    // then
    expect(result).toBe(undefined)
  })

  test("#given non-zero token counts #when classified #then every token field is rejected", async () => {
    // given
    const tokens = [
      { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      { input: 0, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      { input: 0, output: 0, reasoning: 1, cache: { read: 0, write: 0 } },
      { input: 0, output: 0, reasoning: 0, cache: { read: 1, write: 0 } },
      { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 1 } },
    ]

    // when
    const results = await Promise.all(tokens.map((tokenCounts) => resolvePersistedSilentCleanStop(
      createContext({ data: [createMessage(createAssistantInfo({ tokens: tokenCounts }))] }),
      SESSION_ID,
    )))

    // then
    expect(results).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  test("#given a non-unknown finish #when classified #then it is rejected", async () => {
    // given
    const ctx = createContext({ data: [createMessage(createAssistantInfo({ finish: "stop" }))] })

    // when
    const result = await resolvePersistedSilentCleanStop(ctx, SESSION_ID)

    // then
    expect(result).toBe(undefined)
  })

  test("#given a silent turn is stale or not final #when classified #then it is rejected", async () => {
    // given
    const staleContext = createContext({
      data: [createMessage(createAssistantInfo({ sessionID: "other-session" }))],
    })
    const nonFinalContext = createContext({
      data: [
        createMessage(createAssistantInfo()),
        createMessage({ id: "message-user-later", sessionID: SESSION_ID, role: "user" }, [
          { type: "text", text: "new prompt" },
        ]),
      ],
    })

    // when
    const results = await Promise.all([
      resolvePersistedSilentCleanStop(staleContext, SESSION_ID),
      resolvePersistedSilentCleanStop(nonFinalContext, SESSION_ID),
    ])

    // then
    expect(results).toEqual([undefined, undefined])
  })

  test("#given OpenCode retries and later persists assistant output #when idle classification runs #then OMO stands down", async () => {
    // given
    const ctx = createContext({
      data: [
        createMessage(createAssistantInfo()),
        createMessage(
          createAssistantInfo({ id: "message-recovered", finish: "stop" }),
          [{ type: "text", text: "recovered output" }],
        ),
      ],
    })

    // when
    const result = await resolvePersistedSilentCleanStop(ctx, SESSION_ID)

    // then
    expect(result).toBe(undefined)
  })

  test("#given missing or malformed persisted history #when classified #then it fails closed", async () => {
    // given
    const responses = [
      undefined,
      {},
      { data: [] },
      { data: [null] },
      { data: [{ info: createAssistantInfo() }] },
      { data: [createMessage(createAssistantInfo({ id: undefined }))] },
    ]

    // when
    const results = await Promise.all(responses.map((response) => (
      resolvePersistedSilentCleanStop(createContext(response), SESSION_ID)
    )))

    // then
    expect(results).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})
