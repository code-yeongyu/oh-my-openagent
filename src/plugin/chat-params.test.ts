import { afterEach, describe, expect, test } from "bun:test"

import { createChatParamsHandler, type ChatParamsOutput } from "./chat-params"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
} from "../shared/session-prompt-params-state"

describe("createChatParamsHandler", () => {
  afterEach(() => {
    clearSessionPromptParams("ses_chat_params")
  })

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
  test("passes the original mutable message object to chat.params hooks", async () => {
    //#given
    const handler = createChatParamsHandler({
      anthropicEffort: {
        "chat.params": async (input) => {
          input.message.variant = "high"
        },
      },
    })

    const message = { variant: "max" }
    const input = {
      sessionID: "ses_chat_params",
      agent: { name: "sisyphus" },
      model: { providerID: "opencode", modelID: "claude-sonnet-4-6" },
      provider: { id: "opencode" },
      message,
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
    expect(message.variant).toBe("high")
  })

  test("applies stored prompt params for the session", async () => {
    //#given
    setSessionPromptParams("ses_chat_params_temperature", {
      temperature: 0.4,
      topP: 0.7,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
        maxTokens: 4096,
      },
    })

    const handler = createChatParamsHandler({
      anthropicEffort: null,
    })

    const input = {
      sessionID: "ses_chat_params_temperature",
      agent: { name: "oracle" },
      model: { providerID: "openai", modelID: "gpt-5.4" },
      provider: { id: "openai" },
      message: {},
    }

    const output: ChatParamsOutput = {
      temperature: 0.1,
      topP: 1,
      topK: 1,
      options: { existing: true },
    }

    //#when
    await handler(input, output)

    //#then
    expect(output).toEqual({
      temperature: 0.4,
      topP: 0.7,
      topK: 1,
      options: {
        existing: true,
        reasoningEffort: "high",
        thinking: { type: "disabled" },
        maxTokens: 4096,
      },
    })
    expect(getSessionPromptParams("ses_chat_params_temperature")).toEqual({
      temperature: 0.4,
      topP: 0.7,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
        maxTokens: 4096,
      },
    })
  })

  test("preserves gpt-5.4 temperature and clamps maxTokens from bundled model capabilities", async () => {
    //#given
    setSessionPromptParams("ses_chat_params_temperature", {
      temperature: 0.7,
      options: {
        maxTokens: 200_000,
      },
    })

    const handler = createChatParamsHandler({
      anthropicEffort: null,
    })

    const input = {
      sessionID: "ses_chat_params_temperature",
      agent: { name: "oracle" },
      model: { providerID: "openai", modelID: "gpt-5.4" },
      provider: { id: "openai" },
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
    expect(output).toEqual({
      temperature: 0.7,
      topP: 1,
      topK: 1,
      options: {
        maxTokens: 128_000,
      },
    })
  })

  test("drops unsupported reasoning settings from bundled model capabilities", async () => {
    //#given
    setSessionPromptParams("ses_chat_params", {
      temperature: 0.4,
      options: {
        reasoningEffort: "high",
        thinking: { type: "enabled", budgetTokens: 4096 },
      },
    })

    const handler = createChatParamsHandler({
      anthropicEffort: null,
    })

    const input = {
      sessionID: "ses_chat_params",
      agent: { name: "oracle" },
      model: { providerID: "openai", modelID: "gpt-4.1" },
      provider: { id: "openai" },
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
    expect(output).toEqual({
      temperature: 0.4,
      topP: 1,
      topK: 1,
      options: {},
    })
  })
})
