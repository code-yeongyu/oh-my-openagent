import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_REASONING_EFFORTS } from "@oh-my-opencode/model-core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createChatParamsHandler, type ChatParamsOutput } from "./chat-params"
import * as dataPathModule from "../shared/data-path"
import * as sharedModule from "../shared"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
} from "../shared/session-prompt-params-state"

describe("createChatParamsHandler", () => {
  let tempCacheRoot = ""
  let getCacheDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tempCacheRoot = mkdtempSync(join(tmpdir(), "chat-params-cache-"))
    getCacheDirSpy = spyOn(dataPathModule, "getOmoOpenCodeCacheDir").mockReturnValue(
      join(tempCacheRoot, "oh-my-opencode"),
    )
    sharedModule.writeProviderModelsCache({ connected: [], models: {} })
  })

  afterEach(() => {
    clearSessionPromptParams("ses_chat_params")
    clearSessionPromptParams("ses_chat_params_temperature")
    sharedModule.writeProviderModelsCache({ connected: [], models: {} })
    getCacheDirSpy?.mockRestore()
    if (tempCacheRoot) {
      rmSync(tempCacheRoot, { recursive: true, force: true })
    }
  })

  test("applies stored prompt params for the session", async () => {
    //#given
    sharedModule.writeProviderModelsCache({
      connected: [SUPPORTED_PROVIDERS.OPENAI],
      models: {
        openai: [
          {
            id: SUPPORTED_MODELS.GPT_5_4,
            name: "GPT-5.4",
            temperature: true,
            reasoning: true,
            variants: {
              low: {},
              high: {},
            },
            limit: { output: 128_000 },
          },
        ],
      },
    })

    setSessionPromptParams("ses_chat_params_temperature", {
      temperature: 0.4,
      topP: 0.7,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
        thinking: { type: "disabled" },
      },
    })

    const handler = createChatParamsHandler()

    const input = {
      sessionID: "ses_chat_params_temperature",
      agent: { name: "oracle" },
      model: { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_4 },
      provider: { id: SUPPORTED_PROVIDERS.OPENAI },
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
      maxOutputTokens: 4096,
      options: {
        existing: true,
        reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
        thinking: { type: "disabled" },
      },
    })
    expect(getSessionPromptParams("ses_chat_params_temperature")).toEqual({
      temperature: 0.4,
      topP: 0.7,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
        thinking: { type: "disabled" },
      },
    })
  })

  test("drops gpt-5.4 temperature and clamps maxOutputTokens from bundled model capabilities", async () => {
    //#given
    setSessionPromptParams("ses_chat_params_temperature", {
      temperature: 0.7,
      maxOutputTokens: 200_000,
    })

    const handler = createChatParamsHandler()

    const input = {
      sessionID: "ses_chat_params_temperature",
      agent: { name: "oracle" },
      model: { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_4 },
      provider: { id: SUPPORTED_PROVIDERS.OPENAI },
      message: {},
    }

    const output: ChatParamsOutput = {
      temperature: 0.1,
      topP: 1,
      topK: 1,
      options: {},
    }

    //#when
    await handler(input, output)

    //#then
    expect(output).toEqual({
      topP: 1,
      topK: 1,
      maxOutputTokens: 128_000,
      options: {},
    })
  })

  test("drops unsupported reasoning settings from bundled model capabilities", async () => {
    //#given
    setSessionPromptParams("ses_chat_params", {
      temperature: 0.4,
      options: {
        reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
        thinking: { type: "enabled", budgetTokens: 4096 },
      },
    })

    const handler = createChatParamsHandler()

    const input = {
      sessionID: "ses_chat_params",
      agent: { name: "oracle" },
      model: { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: "gpt-4.1" },
      provider: { id: SUPPORTED_PROVIDERS.OPENAI },
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

  test("falls back to default maxOutputTokens when stored and compatibility tokens are non-positive", async () => {
    //#given
    const logSpy = spyOn(sharedModule, "log").mockImplementation(() => undefined)
    setSessionPromptParams("ses_chat_params", {
      maxOutputTokens: 0,
    })

    const handler = createChatParamsHandler()

    const input = {
      sessionID: "ses_chat_params",
      agent: { name: "oracle" },
      model: { providerID: "custom-provider", modelID: "custom-model" },
      provider: { id: "custom-provider" },
      message: {},
    }

    const output: ChatParamsOutput = {
      topP: 1,
      topK: 1,
      maxOutputTokens: 0,
      options: {},
    }

    //#when
    await handler(input, output)

    //#then
    expect(output.maxOutputTokens).toBe(4096)
    expect(logSpy).toHaveBeenCalledWith(
      "[plugin] maxOutputTokens=0 is non-positive; using safe fallback 4096",
    )

    logSpy.mockRestore()
  })

  test("uses safe fallback instead of model max when stored maxOutputTokens is non-positive", async () => {
    //#given
    setSessionPromptParams("ses_chat_params", {
      maxOutputTokens: -1,
    })

    const handler = createChatParamsHandler()

    const input = {
      sessionID: "ses_chat_params",
      agent: { name: "oracle" },
      model: { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_4 },
      provider: { id: SUPPORTED_PROVIDERS.OPENAI },
      message: {},
    }

    const output: ChatParamsOutput = {
      topP: 1,
      topK: 1,
      maxOutputTokens: -1,
      options: {},
    }

    //#when
    await handler(input, output)

    //#then
    expect(output.maxOutputTokens).toBe(4096)
  })
})
