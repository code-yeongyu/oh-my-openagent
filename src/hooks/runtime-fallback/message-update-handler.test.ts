import { describe, expect, it } from "bun:test"
import type { RuntimeFallbackPluginInput } from "./types"
import { hasVisibleAssistantResponse } from "./visible-assistant-response"

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
})
