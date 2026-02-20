import { describe, expect, test } from "bun:test"

import { createChatParamsHandler } from "./chat-params"

describe("createChatParamsHandler", () => {
  test("normalizes object-style agent payload and runs chat.params hooks", async () => {
    //#given
    let called = false
    const handler = createChatParamsHandler({
      anthropicEffort: {
        "chat.params": async (input) => {
          called = input.agent.name === "sisyphus"
        },
      },
    })

    const input = {
      sessionID: "ses_chat_params",
      agent: { name: "sisyphus" },
      model: { providerID: "opencode", modelID: "claude-opus-4-6" },
      provider: { id: "opencode" },
      message: {},
    }

    const output = {
      temperature: 0.1,
      topP: 1,
      topK: 1,
      options: {},
    }

    //#when
    await handler(input, output)

    //#then
    expect(called).toBe(true)
  })
})
