import { describe, expect, it } from "bun:test"
import type { RuntimeFallbackPluginInput } from "./types"
import { hasVisibleAssistantResponse } from "./visible-assistant-response"
import { extractAutoRetrySignal } from "./error-classifier"

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

describe("hasVisibleAssistantResponse", () => {
  it("#given only an old assistant reply before the latest user turn #when visibility is checked #then the stale reply is ignored", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "older question" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "older answer" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-old-assistant", undefined)

    // then
    expect(result).toBe(false)
  })

  it("#given an assistant reply after the latest user turn #when visibility is checked #then the current reply is treated as visible", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "visible answer" }] },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-visible-assistant", undefined)

    // then
    expect(result).toBe(true)
  })

  it("#given a too-many-requests assistant reply #when visibility is checked #then it is treated as an auto-retry signal", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "text",
              text: "Too Many Requests: Sorry, you've exhausted this model's rate limit. Please try a different model.",
            },
          ],
        },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-rate-limit", undefined)

    // then
    expect(result).toBe(false)
  })

  it("#given an assistant reply with reasoning-only progress after the latest user turn #when visibility is checked #then it is treated as visible progress", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        { info: { role: "assistant" }, parts: [{ type: "reasoning", text: "working through the task" }] },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-reasoning-progress", undefined)

    // then
    expect(result).toBe(true)
  })

  it("#given an assistant reply with a completion marker but no text #when visibility is checked #then it is not treated as visible completion", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        { info: { role: "assistant", finish: "stop" }, parts: [] },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-finish-marker", undefined)

    // then
    expect(result).toBe(false)
  })

  it("#given an assistant reply with top-level completion but no payload #when visibility is checked #then it is ignored as non-visible", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { role: "user", parts: [{ type: "text", text: "latest question" }] },
        { role: "assistant", time: { completed: 123 }, tokens: { output: 0, reasoning: 0 }, cost: 0 },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-top-level-empty-completion", undefined)

    // then
    expect(result).toBe(false)
  })

  it("#given an assistant reply with top-level completion and token payload #when visibility is checked #then it is treated as visible completion", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { role: "user", parts: [{ type: "text", text: "latest question" }] },
        { role: "assistant", time: { completed: 123 }, tokens: { output: 24, reasoning: 0 }, cost: 0 },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-top-level-token-completion", undefined)

    // then
    expect(result).toBe(true)
  })

  it("#given an sdk messages response without a data wrapper #when visibility is checked #then top-level payload still drives completion visibility", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      messages: [
        { role: "user", parts: [] },
        { role: "assistant", time: { completed: 123 }, tokens: { output: 12, reasoning: 0 }, cost: 0 },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-raw-sdk-response", undefined)

    // then
    expect(result).toBe(true)
  })
})
