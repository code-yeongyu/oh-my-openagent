import { beforeEach, describe, expect, test } from "bun:test"

import {
  clearPendingModelFallback,
  createModelFallbackHook,
  setPendingModelFallback,
} from "./hook"

describe("model fallback hook", () => {
  beforeEach(() => {
    clearPendingModelFallback("ses_model_fallback_main")
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
})
