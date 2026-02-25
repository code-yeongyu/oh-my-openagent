import { beforeEach, describe, expect, test } from "bun:test"

import {
  clearPendingModelFallback,
  createModelFallbackHook,
  setSessionFallbackChain,
  setPendingModelFallback,
} from "./hook"

describe("model fallback hook", () => {
  beforeEach(() => {
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
      providerID: "opencode",
      modelID: "kimi-k2.5-free",
    })
    expect(secondOutput.message["variant"]).toBeUndefined()
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
      "claude-sonnet-4-6",
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

  test("transforms model names for google provider via fallback chain", async () => {
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
      { providers: ["google"], model: "gemini-3-pro" },
    ])

    const set = setPendingModelFallback(
      sessionID,
      "Oracle",
      "google",
      "gemini-3-pro",
    )
    expect(set).toBe(true)

    const output = {
      message: {
        model: { providerID: "google", modelID: "gemini-3-pro" },
      },
      parts: [{ type: "text", text: "continue" }],
    }

    //#when
    await hook["chat.message"]?.({ sessionID }, output)

    //#then — model name should be transformed from gemini-3-pro to gemini-3-pro-preview
    expect(output.message["model"]).toEqual({
      providerID: "google",
      modelID: "gemini-3-pro-preview",
    })

    clearPendingModelFallback(sessionID)
  })
})
