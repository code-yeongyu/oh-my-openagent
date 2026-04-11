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

  test("does not resolve prototype keys as aliases", () => {
    const result = resolveModelIDAlias("constructor")

    expect(result).toEqual({
      requestedModelID: "constructor",
      canonicalModelID: "constructor",
      source: "canonical",
    })
  })

  test("normalizes provider-prefixed Claude thinking aliases through a pattern rule", () => {
    const result = resolveModelIDAlias("anthropic/claude-opus-4-6-thinking")

    expect(result).toEqual({
      requestedModelID: "anthropic/claude-opus-4-6-thinking",
      canonicalModelID: "claude-opus-4-6",
      source: "pattern-alias",
      ruleID: "claude-thinking-legacy-alias",
    })
  })

  test("does not pattern-match nearby canonical Claude IDs incorrectly", () => {
    const result = resolveModelIDAlias("claude-opus-4-6-think")

    expect(result).toEqual({
      requestedModelID: "claude-opus-4-6-think",
      canonicalModelID: "claude-opus-4-6-think",
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
    const result = resolveModelIDAlias("claude-opus-4-6-thinking")

    expect(result).toEqual({
      requestedModelID: "claude-opus-4-6-thinking",
      canonicalModelID: "claude-opus-4-6",
      source: "pattern-alias",
      ruleID: "claude-thinking-legacy-alias",
    })
  })
})
