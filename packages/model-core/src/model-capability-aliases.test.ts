import { describe, expect, test } from "bun:test"

import { resolveModelIDAlias } from "./model-capability-aliases"

describe("model-capability-aliases", () => {
  test("keeps canonical model IDs unchanged", () => {
    const result = resolveModelIDAlias("gpt-5.4")

    expect(result).toEqual({
      requestedModelID: "gpt-5.4",
      canonicalModelID: "gpt-5.4",
      source: "canonical",
    })
  })

  test("strips provider prefixes when the input is already canonical", () => {
    const result = resolveModelIDAlias("anthropic/claude-sonnet-4-6")

    expect(result).toEqual({
      requestedModelID: "anthropic/claude-sonnet-4-6",
      canonicalModelID: "claude-sonnet-4-6",
      source: "canonical",
    })
  })

  test("normalizes gemini tier aliases through a pattern rule", () => {
    const result = resolveModelIDAlias("gemini-3.1-pro-high")

    expect(result).toEqual({
      requestedModelID: "gemini-3.1-pro-high",
      canonicalModelID: "gemini-3.1-pro",
      source: "pattern-alias",
      ruleID: "gemini-3.1-pro-tier-alias",
    })
  })

  test("normalizes provider-prefixed gemini tier aliases to bare canonical IDs", () => {
    const result = resolveModelIDAlias("google/gemini-3.1-pro-high")

    expect(result).toEqual({
      requestedModelID: "google/gemini-3.1-pro-high",
      canonicalModelID: "gemini-3.1-pro",
      source: "pattern-alias",
      ruleID: "gemini-3.1-pro-tier-alias",
    })
  })

  test("keeps exceptional gemini preview aliases as exact rules", () => {
    const result = resolveModelIDAlias("gemini-3-pro-high")

    expect(result).toEqual({
      requestedModelID: "gemini-3-pro-high",
      canonicalModelID: "gemini-3-pro-preview",
      source: "exact-alias",
      ruleID: "gemini-3-pro-tier-alias",
    })
  })

  test("normalizes Kimi for Coding k2pb aliases to the snapshot ID", () => {
    const result = resolveModelIDAlias("kimi-for-coding/k2pb")

    expect(result).toEqual({
      requestedModelID: "kimi-for-coding/k2pb",
      canonicalModelID: "k2p5",
      source: "exact-alias",
      ruleID: "kimi-k2pb-alias",
    })
  })

  test("normalizes Kimi for Coding k3 aliases to the snapshot ID", () => {
    const result = resolveModelIDAlias("kimi-for-coding/k3")

    expect(result).toEqual({
      requestedModelID: "kimi-for-coding/k3",
      canonicalModelID: "kimi-k3",
      source: "exact-alias",
      ruleID: "kimi-k3-alias",
    })
  })

  test("normalizes a bare k3 model ID to the kimi-k3 snapshot ID", () => {
    const result = resolveModelIDAlias("k3")

    expect(result).toEqual({
      requestedModelID: "k3",
      canonicalModelID: "kimi-k3",
      source: "exact-alias",
      ruleID: "kimi-k3-alias",
    })
  })

  test("does not alias unrelated IDs that only contain k3 as a prefix", () => {
    const result = resolveModelIDAlias("some-provider/k3-highspeed")

    expect(result).toEqual({
      requestedModelID: "some-provider/k3-highspeed",
      canonicalModelID: "k3-highspeed",
      source: "canonical",
    })
  })

  test("does not alias Kimi for Coding k3 variant IDs", () => {
    const result = resolveModelIDAlias("kimi-for-coding/k3-thinking")

    expect(result).toEqual({
      requestedModelID: "kimi-for-coding/k3-thinking",
      canonicalModelID: "k3-thinking",
      source: "canonical",
    })
  })

  test("treats GitHub Copilot dotted Claude Opus 4.7 as canonical since models.dev now serves it natively", () => {
    const result = resolveModelIDAlias("github-copilot/claude-opus-4.7")

    expect(result).toEqual({
      requestedModelID: "github-copilot/claude-opus-4.7",
      canonicalModelID: "claude-opus-4.7",
      source: "canonical",
    })
  })

  test("does not resolve prototype keys as aliases", () => {
    const result = resolveModelIDAlias("constructor")

    expect(result).toEqual({
      requestedModelID: "constructor",
      canonicalModelID: "constructor",
      source: "canonical",
    })
  })

  test("normalizes provider-prefixed Claude thinking aliases through a pattern rule", () => {
    const result = resolveModelIDAlias("anthropic/claude-opus-4-7-thinking")

    expect(result).toEqual({
      requestedModelID: "anthropic/claude-opus-4-7-thinking",
      canonicalModelID: "claude-opus-4-7",
      source: "pattern-alias",
      ruleID: "claude-thinking-legacy-alias",
    })
  })

  test("does not pattern-match nearby canonical Claude IDs incorrectly", () => {
    const result = resolveModelIDAlias("claude-opus-4-7-think")

    expect(result).toEqual({
      requestedModelID: "claude-opus-4-7-think",
      canonicalModelID: "claude-opus-4-7-think",
      source: "canonical",
    })
  })

  test("does not pattern-match canonical gemini preview IDs incorrectly", () => {
    const result = resolveModelIDAlias("gemini-3.1-pro-preview")

    expect(result).toEqual({
      requestedModelID: "gemini-3.1-pro-preview",
      canonicalModelID: "gemini-3.1-pro-preview",
      source: "canonical",
    })
  })

  test("normalizes legacy Claude thinking aliases through a pattern rule", () => {
    const result = resolveModelIDAlias("claude-opus-4-7-thinking")

    expect(result).toEqual({
      requestedModelID: "claude-opus-4-7-thinking",
      canonicalModelID: "claude-opus-4-7",
      source: "pattern-alias",
      ruleID: "claude-thinking-legacy-alias",
    })
  })

  test("treats claude-opus-4-6-thinking as canonical, not as a legacy alias", () => {
    const result = resolveModelIDAlias("claude-opus-4-6-thinking")

    expect(result).toEqual({
      requestedModelID: "claude-opus-4-6-thinking",
      canonicalModelID: "claude-opus-4-6-thinking",
      source: "canonical",
    })
  })

  test("normalizes OpenAI GPT-5.6 fast service-tier aliases", () => {
    const aliases = ["gpt-5.6-sol-fast", "gpt-5.6-terra-fast", "gpt-5.6-luna-fast"]

    for (const aliasModelID of aliases) {
      const result = resolveModelIDAlias(aliasModelID, "openai")

      expect(result).toEqual({
        requestedModelID: aliasModelID,
        canonicalModelID: aliasModelID.slice(0, -"-fast".length),
        source: "pattern-alias",
        ruleID: "openai-gpt-5.6-fast-service-tier-alias",
      })
    }
  })

  test("does not normalize GPT-5.6 fast suffixes for unrelated providers or nearby IDs", () => {
    expect(resolveModelIDAlias("gpt-5.6-sol-fast", "github-copilot")).toMatchObject({
      canonicalModelID: "gpt-5.6-sol-fast",
      source: "canonical",
    })
    expect(resolveModelIDAlias("gpt-5.6-sol-fast-preview", "openai")).toMatchObject({
      canonicalModelID: "gpt-5.6-sol-fast-preview",
      source: "canonical",
    })
  })

  test("does not normalize OpenAI subprovider aliases for unrelated top-level providers", () => {
    const result = resolveModelIDAlias("openai/gpt-5.6-sol-fast", "anthropic")

    expect(result).toEqual({
      requestedModelID: "openai/gpt-5.6-sol-fast",
      canonicalModelID: "gpt-5.6-sol-fast",
      source: "canonical",
    })
  })
})
