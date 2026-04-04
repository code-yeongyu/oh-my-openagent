import { describe, test, it, expect } from "bun:test"
import {
  parseFallbackModelEntry,
  parseFallbackModelObjectEntry,
  buildFallbackChainFromModels,
  findMostSpecificFallbackEntry,
} from "./fallback-chain-from-models"
import { flattenToFallbackModelStrings } from "./model-resolver"

// Upstream tests
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

// Object-style entry tests
describe("parseFallbackModelEntry (extended)", () => {
  it("parses provider/model string", () => {
    const result = parseFallbackModelEntry("anthropic/claude-sonnet-4-6", undefined)
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
    })
  })

  it("parses model with parenthesized variant", () => {
    const result = parseFallbackModelEntry("anthropic/claude-sonnet-4-6(high)", undefined)
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
      variant: "high",
    })
  })

  it("parses model with space variant", () => {
    const result = parseFallbackModelEntry("openai/gpt-5.4 xhigh", undefined)
    expect(result).toEqual({
      providers: ["openai"],
      model: "gpt-5.4",
      variant: "xhigh",
    })
  })

  it("parses model with minimal space variant", () => {
    const result = parseFallbackModelEntry("openai/gpt-5.4 minimal", undefined)
    expect(result).toEqual({
      providers: ["openai"],
      model: "gpt-5.4",
      variant: "minimal",
    })
  })

  it("uses context provider when no provider prefix", () => {
    const result = parseFallbackModelEntry("claude-sonnet-4-6", "anthropic")
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
    })
  })

  it("returns undefined for empty string", () => {
    expect(parseFallbackModelEntry("", undefined)).toBeUndefined()
    expect(parseFallbackModelEntry("  ", undefined)).toBeUndefined()
  })
})

describe("parseFallbackModelObjectEntry", () => {
  it("parses object with model only", () => {
    const result = parseFallbackModelObjectEntry(
      { model: "anthropic/claude-sonnet-4-6" },
      undefined,
    )
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
    })
  })

  it("parses object with variant override", () => {
    const result = parseFallbackModelObjectEntry(
      { model: "anthropic/claude-sonnet-4-6", variant: "high" },
      undefined,
    )
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
      variant: "high",
    })
  })

  it("object variant overrides inline variant", () => {
    const result = parseFallbackModelObjectEntry(
      { model: "anthropic/claude-sonnet-4-6(low)", variant: "high" },
      undefined,
    )
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
      variant: "high",
    })
  })

  it("carries reasoningEffort and temperature", () => {
    const result = parseFallbackModelObjectEntry(
      {
        model: "openai/gpt-5.4",
        variant: "high",
        reasoningEffort: "high",
        temperature: 0.5,
      },
      undefined,
    )
    expect(result).toEqual({
      providers: ["openai"],
      model: "gpt-5.4",
      variant: "high",
      reasoningEffort: "high",
      temperature: 0.5,
    })
  })

  it("carries thinking config", () => {
    const result = parseFallbackModelObjectEntry(
      {
        model: "anthropic/claude-sonnet-4-6",
        thinking: { type: "enabled", budgetTokens: 10000 },
      },
      undefined,
    )
    expect(result).toEqual({
      providers: ["anthropic"],
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budgetTokens: 10000 },
    })
  })

  it("carries all optional fields", () => {
    const result = parseFallbackModelObjectEntry(
      {
        model: "openai/gpt-5.4",
        variant: "xhigh",
        reasoningEffort: "xhigh",
        temperature: 0.3,
        top_p: 0.9,
        maxTokens: 8192,
        thinking: { type: "disabled" },
      },
      undefined,
    )
    expect(result).toEqual({
      providers: ["openai"],
      model: "gpt-5.4",
      variant: "xhigh",
      reasoningEffort: "xhigh",
      temperature: 0.3,
      top_p: 0.9,
      maxTokens: 8192,
      thinking: { type: "disabled" },
    })
  })
})

describe("buildFallbackChainFromModels (mixed)", () => {
  it("handles string input", () => {
    const result = buildFallbackChainFromModels("anthropic/claude-sonnet-4-6", undefined)
    expect(result).toEqual([
      { providers: ["anthropic"], model: "claude-sonnet-4-6" },
    ])
  })

  it("handles string array", () => {
    const result = buildFallbackChainFromModels(
      ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"],
      undefined,
    )
    expect(result).toEqual([
      { providers: ["anthropic"], model: "claude-sonnet-4-6" },
      { providers: ["openai"], model: "gpt-5.4" },
    ])
  })

  it("handles mixed array of strings and objects", () => {
    const result = buildFallbackChainFromModels(
      [
        { model: "anthropic/claude-sonnet-4-6", variant: "high", reasoningEffort: "high" },
        { model: "openai/gpt-5.4", reasoningEffort: "xhigh" },
        "chutes/kimi-k2.5",
        { model: "chutes/glm-5", temperature: 0.7 },
        "google/gemini-3-flash",
      ],
      undefined,
    )
    expect(result).toEqual([
      { providers: ["anthropic"], model: "claude-sonnet-4-6", variant: "high", reasoningEffort: "high" },
      { providers: ["openai"], model: "gpt-5.4", reasoningEffort: "xhigh" },
      { providers: ["chutes"], model: "kimi-k2.5" },
      { providers: ["chutes"], model: "glm-5", temperature: 0.7 },
      { providers: ["google"], model: "gemini-3-flash" },
    ])
  })

  it("returns undefined for empty/undefined input", () => {
    expect(buildFallbackChainFromModels(undefined, undefined)).toBeUndefined()
    expect(buildFallbackChainFromModels([], undefined)).toBeUndefined()
  })

  it("filters out invalid entries", () => {
    const result = buildFallbackChainFromModels(
      ["", "anthropic/claude-sonnet-4-6", "  "],
      undefined,
    )
    expect(result).toEqual([
      { providers: ["anthropic"], model: "claude-sonnet-4-6" },
    ])
  })
})

describe("flattenToFallbackModelStrings", () => {
  it("returns undefined for undefined input", () => {
    expect(flattenToFallbackModelStrings(undefined)).toBeUndefined()
  })

  it("passes through plain strings", () => {
    expect(flattenToFallbackModelStrings(["anthropic/claude-sonnet-4-6"])).toEqual([
      "anthropic/claude-sonnet-4-6",
    ])
  })

  it("flattens object with explicit variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "anthropic/claude-sonnet-4-6", variant: "high" },
    ])).toEqual(["anthropic/claude-sonnet-4-6(high)"])
  })

  it("preserves inline variant when no explicit variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "anthropic/claude-sonnet-4-6(high)" },
    ])).toEqual(["anthropic/claude-sonnet-4-6(high)"])
  })

  it("explicit variant overrides inline variant (no double-suffix)", () => {
    expect(flattenToFallbackModelStrings([
      { model: "anthropic/claude-sonnet-4-6(low)", variant: "high" },
    ])).toEqual(["anthropic/claude-sonnet-4-6(high)"])
  })

  it("explicit variant overrides space-suffix variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "openai/gpt-5.4 high", variant: "low" },
    ])).toEqual(["openai/gpt-5.4(low)"])
  })

  it("explicit variant overrides minimal space-suffix variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "openai/gpt-5.4 minimal", variant: "low" },
    ])).toEqual(["openai/gpt-5.4(low)"])
  })

  it("preserves trailing non-variant suffixes when adding explicit variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "openai/gpt-5.4 preview", variant: "low" },
    ])).toEqual(["openai/gpt-5.4 preview(low)"])
  })

  it("flattens object without variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "openai/gpt-5.4" },
    ])).toEqual(["openai/gpt-5.4"])
  })

  it("handles mixed array", () => {
    expect(flattenToFallbackModelStrings([
      "anthropic/claude-sonnet-4-6",
      { model: "openai/gpt-5.4", variant: "high" },
      { model: "google/gemini-3-flash(low)" },
    ])).toEqual([
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4(high)",
      "google/gemini-3-flash(low)",
    ])
  })
})

describe("findMostSpecificFallbackEntry", () => {
  it("picks exact match over prefix match", () => {
    const chain = [
      { providers: ["openai"], model: "gpt-5.4" },
      { providers: ["openai"], model: "gpt-5.4-preview" },
    ]
    const result = findMostSpecificFallbackEntry("openai", "gpt-5.4-preview", chain)
    expect(result?.model).toBe("gpt-5.4-preview")
  })

  it("returns prefix match when no exact match exists", () => {
    const chain = [
      { providers: ["openai"], model: "gpt-5.4" },
    ]
    const result = findMostSpecificFallbackEntry("openai", "gpt-5.4-preview", chain)
    expect(result?.model).toBe("gpt-5.4")
  })

  it("returns undefined when no entry matches", () => {
    const chain = [
      { providers: ["anthropic"], model: "claude-sonnet-4-6" },
    ]
    expect(findMostSpecificFallbackEntry("openai", "gpt-5.4", chain)).toBeUndefined()
  })

  it("sorts by matched prefix length, not insertion order", () => {
    // Both entries share the same provider so both match as prefixes;
    // the longer (more-specific) prefix must win regardless of array order.
    const chain = [
      { providers: ["openai"], model: "gpt-5" },
      { providers: ["openai"], model: "gpt-5.4-preview" },
    ]
    const result = findMostSpecificFallbackEntry("openai", "gpt-5.4-preview-2026", chain)
    expect(result?.model).toBe("gpt-5.4-preview")
  })

  it("is case-insensitive", () => {
    const chain = [
      { providers: ["OpenAI"], model: "GPT-5.4" },
    ]
    const result = findMostSpecificFallbackEntry("openai", "gpt-5.4-preview", chain)
    expect(result?.model).toBe("GPT-5.4")
  })

  it("preserves variant and settings from matched entry", () => {
    const chain = [
      { providers: ["openai"], model: "gpt-5.4", variant: "high", temperature: 0.7 },
      { providers: ["openai"], model: "gpt-5.4-preview", variant: "low", reasoningEffort: "medium" },
    ]
    const result = findMostSpecificFallbackEntry("openai", "gpt-5.4-preview", chain)
    expect(result).toEqual({
      providers: ["openai"],
      model: "gpt-5.4-preview",
      variant: "low",
      reasoningEffort: "medium",
    })
  })
})
