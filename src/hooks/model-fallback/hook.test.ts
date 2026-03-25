declare const require: (name: string) => any
const { beforeEach, describe, expect, mock, test } = require("bun:test")

const readConnectedProvidersCacheMock = mock(() => null)
const readProviderModelsCacheMock = mock(() => null)
const transformModelForProviderMock = mock((provider: string, model: string) => {
  if (provider === "github-copilot") {
    return model
      .replace("claude-opus-4-6", "claude-opus-4.6")
      .replace("claude-sonnet-4-6", "claude-sonnet-4.6")
      .replace("claude-sonnet-4-5", "claude-sonnet-4.5")
      .replace("claude-haiku-4-5", "claude-haiku-4.5")
      .replace("claude-sonnet-4", "claude-sonnet-4")
      .replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
      .replace(/gemini-3-flash(?!-)/g, "gemini-3-flash-preview")
  }
  if (provider === "google") {
    return model
      .replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
      .replace(/gemini-3-flash(?!-)/g, "gemini-3-flash-preview")
  }
  return model
})

mock.module("../../shared/connected-providers-cache", () => ({
  readConnectedProvidersCache: readConnectedProvidersCacheMock,
  readProviderModelsCache: readProviderModelsCacheMock,
}))

mock.module("../../shared/provider-model-id-transform", () => ({
  transformModelForProvider: transformModelForProviderMock,
}))

import {
  clearPendingModelFallback,
  createModelFallbackHook,
  setSessionFallbackChain,
  setPendingModelFallback,
} from "./hook"

describe("model fallback hook", () => {
  beforeEach(() => {
    readConnectedProvidersCacheMock.mockReturnValue(null)
    readProviderModelsCacheMock.mockReturnValue(null)
    readConnectedProvidersCacheMock.mockClear()
    readProviderModelsCacheMock.mockClear()

    clearPendingModelFallback("ses_model_fallback_main")
    clearPendingModelFallback("ses_model_fallback_ghcp")
    clearPendingModelFallback("ses_model_fallback_google")
  })

  test("applies pending fallback on chat.message by overriding model", async () => {
    //#given
    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    const set = setPendingModelFallback(
      "ses_model_fallback_main",
      "Sisyphus (Ultraworker)",
      "anthropic",
      "claude-opus-4-6-thinking",
    )
    expect(set).toBe(true)

    const output = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
        variant: "max",
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.(
      { sessionID: "ses_model_fallback_main" },
      output,
    )

    //#then
    expect(output.message["model"]).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    })
  })

  test("preserves fallback progression across repeated session.error retries", async () => {
    //#given
    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }
    const sessionID = "ses_model_fallback_main"

    expect(
      setPendingModelFallback(sessionID, "Sisyphus (Ultraworker)", "anthropic", "claude-opus-4-6-thinking"),
    ).toBe(true)

    const firstOutput = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
        variant: "max",
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when - first retry is applied
    await hook["chat.message"]?.({ sessionID }, firstOutput)

    //#then
    expect(firstOutput.message["model"]).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    })

    //#when - second error re-arms fallback and should advance to next entry
    expect(
      setPendingModelFallback(sessionID, "Sisyphus (Ultraworker)", "anthropic", "claude-opus-4-6"),
    ).toBe(true)

    const secondOutput = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      },
      parts: [{ type: "text", text: "continue" }],
    }
    await hook["chat.message"]?.({ sessionID }, secondOutput)

    //#then - chain should progress to entry[1], not repeat entry[0]
    expect(secondOutput.message["model"]).toEqual({
      providerID: "opencode-go",
      modelID: "kimi-k2.5",
    })
    expect(secondOutput.message["variant"]).toBeUndefined()
  })

  test("does not re-arm fallback when one is already pending", () => {
    //#given
    const sessionID = "ses_model_fallback_pending_guard"
    clearPendingModelFallback(sessionID)

    //#when
    const firstSet = setPendingModelFallback(
      sessionID,
      "Sisyphus (Ultraworker)",
      "anthropic",
      "claude-opus-4-6-thinking",
    )
    const secondSet = setPendingModelFallback(
      sessionID,
      "Sisyphus (Ultraworker)",
      "anthropic",
      "claude-opus-4-6-thinking",
    )

    //#then
    expect(firstSet).toBe(true)
    expect(secondSet).toBe(false)
    clearPendingModelFallback(sessionID)
  })

  test("skips no-op fallback entries that resolve to same provider/model", async () => {
    //#given
    const sessionID = "ses_model_fallback_noop_skip"
    clearPendingModelFallback(sessionID)

    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    setSessionFallbackChain(sessionID, [
      { providers: ["anthropic"], model: "claude-opus-4-6" },
      { providers: ["opencode"], model: "kimi-k2.5-free" },
    ])

    expect(
      setPendingModelFallback(
        sessionID,
        "Sisyphus (Ultraworker)",
        "anthropic",
        "claude-opus-4-6",
      ),
    ).toBe(true)

    const output = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID }, output)

    //#then
    expect(output.message["model"]).toEqual({
      providerID: "opencode",
      modelID: "kimi-k2.5-free",
    })
    clearPendingModelFallback(sessionID)
  })

  test("skips no-op fallback entries even when variant differs", async () => {
    //#given
    const sessionID = "ses_model_fallback_noop_variant_skip"
    clearPendingModelFallback(sessionID)

    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    setSessionFallbackChain(sessionID, [
      { providers: ["quotio"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["quotio"], model: "gpt-5.2" },
    ])

    expect(
      setPendingModelFallback(
        sessionID,
        "Sisyphus (Ultraworker)",
        "quotio",
        "claude-opus-4-6",
      ),
    ).toBe(true)

    const output = {
      message: {
        model: { providerID: "quotio", modelID: "claude-opus-4-6" },
        variant: "max",
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID }, output)

    //#then
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "gpt-5.2",
    })
    expect(output.message["variant"]).toBeUndefined()
    clearPendingModelFallback(sessionID)
  })

  test("uses connected preferred provider when fallback entry providers are disconnected", async () => {
    //#given
    const sessionID = "ses_model_fallback_preferred_provider"
    clearPendingModelFallback(sessionID)
    readConnectedProvidersCacheMock.mockReturnValue(["provider-x"])

    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    setSessionFallbackChain(sessionID, [
      { providers: ["provider-y"], model: "fallback-model" },
    ])

    expect(
      setPendingModelFallback(
        sessionID,
        "Sisyphus (Ultraworker)",
        "provider-x",
        "current-model",
      ),
    ).toBe(true)

    const output = {
      message: {
        model: { providerID: "provider-x", modelID: "current-model" },
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID }, output)

    //#then
    expect(output.message["model"]).toEqual({
      providerID: "provider-x",
      modelID: "fallback-model",
    })
    clearPendingModelFallback(sessionID)
  })

  test("shows toast when fallback is applied", async () => {
    //#given
    const toastCalls: Array<{ title: string; message: string }> = []
    const hook = createModelFallbackHook({
      toast: async ({ title, message }) => {
        toastCalls.push({ title, message })
      },
    }) as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    const set = setPendingModelFallback(
      "ses_model_fallback_toast",
      "Sisyphus (Ultraworker)",
      "anthropic",
      "claude-opus-4-6-thinking",
    )
    expect(set).toBe(true)

    const output = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
        variant: "max",
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID: "ses_model_fallback_toast" }, output)

    //#then
    expect(toastCalls.length).toBe(1)
    expect(toastCalls[0]?.title).toBe("Model fallback")
  })

  test("transforms model names for github-copilot provider via fallback chain", async () => {
    //#given
    const sessionID = "ses_model_fallback_ghcp"
    clearPendingModelFallback(sessionID)

    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    // Set a custom fallback chain that routes through github-copilot
    setSessionFallbackChain(sessionID, [
      { providers: ["github-copilot"], model: "claude-sonnet-4-6" },
    ])

    const set = setPendingModelFallback(
      sessionID,
      "Atlas (Plan Executor)",
      "github-copilot",
      "claude-sonnet-4-5",
    )
    expect(set).toBe(true)

    const output = {
      message: {
        model: { providerID: "github-copilot", modelID: "claude-sonnet-4-6" },
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID }, output)

    //#then — model name should be transformed from hyphen to dot notation
    expect(output.message["model"]).toEqual({
      providerID: "github-copilot",
      modelID: "claude-sonnet-4.6",
    })

    clearPendingModelFallback(sessionID)
  })

  test("preserves canonical google preview model names via fallback chain", async () => {
    //#given
    const sessionID = "ses_model_fallback_google"
    clearPendingModelFallback(sessionID)

    const hook = createModelFallbackHook() as unknown as {
      "chat.message"?: (
        input: { sessionID: string },
        output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
      ) => Promise<void>
    }

    // Set a custom fallback chain that routes through google
    setSessionFallbackChain(sessionID, [
      { providers: ["google"], model: "gemini-3.1-pro-preview" },
    ])

    const set = setPendingModelFallback(
      sessionID,
      "Oracle",
      "google",
      "gemini-3.1-pro-preview",
    )
    expect(set).toBe(true)

    const output = {
      message: {
        model: { providerID: "google", modelID: "gemini-3.1-pro-preview" },
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID }, output)

    //#then: model name should remain gemini-3.1-pro-preview because no google transform exists for this ID
    expect(output.message["model"]).toEqual({
      providerID: "google",
      modelID: "gemini-3.1-pro-preview",
    })

    clearPendingModelFallback(sessionID)
  })
})
