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

  test("normalizes exact local tier aliases to canonical models.dev IDs", () => {
    const result = resolveModelIDAlias("gemini-3.1-pro-high")

    expect(result).toEqual({
      requestedModelID: "gemini-3.1-pro-high",
      canonicalModelID: "gemini-3.1-pro-preview",
      source: "exact-alias",
      ruleID: "gemini-3.1-pro-tier-alias",
    })
  })

  test("normalizes decorated thinking aliases through a named pattern rule", () => {
    const result = resolveModelIDAlias("claude-opus-4-6-thinking")

    expect(result).toEqual({
      requestedModelID: "claude-opus-4-6-thinking",
      canonicalModelID: "claude-opus-4-6",
      source: "pattern-alias",
      ruleID: "anthropic-thinking-suffix",
    })
  })
})
