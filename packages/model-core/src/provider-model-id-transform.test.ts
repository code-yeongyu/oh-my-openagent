import { describe, expect, test } from "bun:test"

import { transformModelForProvider } from "./provider-model-id-transform"

describe("provider model id transform", () => {
  test("transforms kimi models for kimi coding providers", () => {
    // given
    const provider = "kimi-coding"

    // when
    const transformed = transformModelForProvider(provider, "kimi-k3")
    const transformed256k = transformModelForProvider(provider, "kimi-k3-256k")

    // then
    expect(transformed).toBe("k3")
    expect(transformed256k).toBe("k3-256k")
  })

  test("passes through unrelated models unchanged", () => {
    // given
    const provider = "kimi-for-coding"

    // when
    const transformed = transformModelForProvider(provider, "gpt-5.6-luna-fast")

    // then
    expect(transformed).toBe("gpt-5.6-luna-fast")
  })

  test("keeps antigravity-gemini-3.1-pro ids out of the -preview rewrite (#8499)", () => {
    // given
    const scenarios = [
      { provider: "google", model: "antigravity-gemini-3.1-pro" },
      { provider: "google", model: "google/antigravity-gemini-3.1-pro" },
      { provider: "github-copilot", model: "antigravity-gemini-3.1-pro" },
      { provider: "vercel", model: "google/antigravity-gemini-3.1-pro" },
    ] as const

    for (const scenario of scenarios) {
      // when
      const transformed = transformModelForProvider(scenario.provider, scenario.model)

      // then
      expect(transformed).toBe(scenario.model)
    }
  })

  test("still rewrites plain gemini-3.1-pro to the -preview id", () => {
    // given
    const scenarios = [
      { provider: "google", model: "gemini-3.1-pro", expected: "gemini-3.1-pro-preview" },
      { provider: "github-copilot", model: "gemini-3.1-pro", expected: "gemini-3.1-pro-preview" },
      { provider: "vercel", model: "google/gemini-3.1-pro", expected: "google/gemini-3.1-pro-preview" },
      { provider: "google", model: "gemini-3.1-pro-preview", expected: "gemini-3.1-pro-preview" },
    ] as const

    for (const scenario of scenarios) {
      // when
      const transformed = transformModelForProvider(scenario.provider, scenario.model)

      // then
      expect(transformed).toBe(scenario.expected)
    }
  })
})
