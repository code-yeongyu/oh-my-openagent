import { describe, expect, test } from "bun:test"

import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("category routing policy", () => {
  test("visual-engineering prioritizes Opus high, Kimi K3 max, then Fable low", () => {
    // given
    const visual = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const leadingChain = visual.fallbackChain.slice(0, 3)

    // then
    expect(leadingChain).toEqual([
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "high",
      },
      {
        providers: ["apitopia", "opencode-go", "kimi-for-coding", "moonshotai", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-fable-5",
        variant: "low",
      },
    ])
  })

  test("quick prioritizes HighSpeed, GPT Mini Fast, then Haiku", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const leadingChain = quick.fallbackChain.slice(0, 3)

    // then
    expect(leadingChain).toEqual([
      { providers: ["apitopia"], model: "kimi-for-coding-highspeed" },
      { providers: ["quotio-openai"], model: "gpt-5.4-mini-fast" },
      {
        providers: ["anthropic-api", "anthropic", "github-copilot", "vercel"],
        model: "claude-haiku-4-5",
      },
    ])
  })

  test("unspecified-high prioritizes Kimi K3 max then Opus high", () => {
    // given
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when
    const leadingChain = unspecifiedHigh.fallbackChain.slice(0, 2)

    // then
    expect(leadingChain).toEqual([
      {
        providers: ["apitopia", "opencode-go", "kimi-for-coding", "moonshotai", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "high",
      },
    ])
  })
})
