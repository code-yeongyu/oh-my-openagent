import { describe, test, expect } from "bun:test"
import { buildFallbackChainFromModels, parseFallbackModelEntry } from "./fallback-chain-from-models"

describe("fallback-chain-from-models", () => {
  test("parses provider/model entry with parenthesized variant", () => {
    //#given
    const fallbackModel = "openai/gpt-5.2(high)"

    //#when
    const parsed = parseFallbackModelEntry(fallbackModel, "quotio")

    //#then
    expect(parsed).toEqual({
      providers: ["openai"],
      model: "gpt-5.2",
      variant: "high",
    })
  })

  test("uses default provider when fallback model omits provider prefix", () => {
    //#given
    const fallbackModel = "glm-5"

    //#when
    const parsed = parseFallbackModelEntry(fallbackModel, "quotio")

    //#then
    expect(parsed).toEqual({
      providers: ["quotio"],
      model: "glm-5",
      variant: undefined,
    })
  })

  test("uses opencode as absolute fallback provider when context provider is missing", () => {
    //#given
    const fallbackModel = "gemini-3-flash"

    //#when
    const parsed = parseFallbackModelEntry(fallbackModel, undefined)

    //#then
    expect(parsed).toEqual({
      providers: ["opencode"],
      model: "gemini-3-flash",
      variant: undefined,
    })
  })

  test("builds fallback chain from normalized fallback_models input", () => {
    //#given
    const fallbackModels = ["quotio/kimi-k2.5", "gpt-5.2 medium"]

    //#when
    const chain = buildFallbackChainFromModels(fallbackModels, "quotio")

    //#then
    expect(chain).toEqual([
      { providers: ["quotio"], model: "kimi-k2.5", variant: undefined },
      { providers: ["quotio"], model: "gpt-5.2", variant: "medium" },
    ])
  })
})
