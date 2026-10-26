import { describe, expect, test } from "bun:test"

import { excludedModelPattern, isExcludedModel } from "./excluded-models"

describe("excludedModelPattern", () => {
  test("#given a bare model id #when matching #then it keeps that model out on every provider", () => {
    // given
    const patterns = ["claude-fable-5-1"]

    // when / then
    expect(excludedModelPattern("anthropic/claude-fable-5-1", patterns)).toBe("claude-fable-5-1")
    expect(excludedModelPattern("github-copilot/claude-fable-5-1", patterns)).toBe("claude-fable-5-1")
    expect(isExcludedModel("anthropic/claude-opus-5-5", patterns)).toBe(false)
  })

  test("#given a provider-scoped entry #when matching #then only that provider's copy is kept out", () => {
    // given
    const patterns = ["opencode/claude-fable-5-1"]

    // when / then
    expect(isExcludedModel("opencode/claude-fable-5-1", patterns)).toBe(true)
    expect(isExcludedModel("anthropic/claude-fable-5-1", patterns)).toBe(false)
  })

  test("#given a wildcard entry #when matching #then every build of the family matches, ignoring case", () => {
    // given
    const patterns = ["Claude-Fable-*"]

    // when / then
    expect(isExcludedModel("anthropic/claude-fable-5-1", patterns)).toBe(true)
    expect(isExcludedModel("anthropic-subscription/claude-fable-5", patterns)).toBe(true)
    expect(isExcludedModel("anthropic/claude-opus-5-5", patterns)).toBe(false)
  })

  test("#given a gateway id that nests a provider #when matching #then a bare entry and a provider-scoped entry both match its tail", () => {
    // given
    const nested = "openrouter/anthropic/claude-fable-5-1"

    // when / then
    expect(isExcludedModel(nested, ["claude-fable-*"])).toBe(true)
    expect(isExcludedModel(nested, ["anthropic/claude-fable-5-1"])).toBe(true)
    expect(isExcludedModel(nested, ["openrouter/anthropic/claude-fable-5-1"])).toBe(true)
    expect(isExcludedModel(nested, ["openrouter/claude-fable-5-1"])).toBe(false)
    expect(isExcludedModel(nested, ["anthropic"])).toBe(false)
  })

  test("#given regex metacharacters and blank entries #when matching #then they are literal and inert", () => {
    // given
    const patterns = ["  ", "gpt-6.1-sol"]

    // when / then
    expect(isExcludedModel("openai/gpt-6.1-sol", patterns)).toBe(true)
    expect(isExcludedModel("openai/gpt-6x1-sol", patterns)).toBe(false)
    expect(isExcludedModel("openai/gpt-6.1-sol", undefined)).toBe(false)
  })
})
