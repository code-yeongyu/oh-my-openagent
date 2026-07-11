import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS , SUPPORTED_REASONING_EFFORTS } from "@oh-my-opencode/model-core";
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
    const fallbackModel = "openai/gpt-5.5(high)"

    //#when
    const parsed = parseFallbackModelEntry(fallbackModel, "quotio")

    //#then
    expect(parsed).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  test("uses default provider when fallback model omits provider prefix", () => {
    //#given
    const fallbackModel = SUPPORTED_MODELS.GLM_5

    //#when
    const parsed = parseFallbackModelEntry(fallbackModel, "quotio")

    //#then
    expect(parsed).toEqual({
      providers: ["quotio"],
      model: SUPPORTED_MODELS.GLM_5,
      variant: undefined,
    })
  })

  test("uses opencode as absolute fallback provider when context provider is missing", () => {
    //#given
    const fallbackModel = SUPPORTED_MODELS.GEMINI_3_FLASH

    //#when
    const parsed = parseFallbackModelEntry(fallbackModel, undefined)

    //#then
    expect(parsed).toEqual({
      providers: ["opencode"],
      model: SUPPORTED_MODELS.GEMINI_3_FLASH,
      variant: undefined,
    })
  })

  test("builds fallback chain from normalized fallback_models input", () => {
    //#given
    const fallbackModels = ["quotio/kimi-k2.5", "gpt-5.5 medium"]

    //#when
    const chain = buildFallbackChainFromModels(fallbackModels, "quotio")

    //#then
    expect(chain).toEqual([
      { providers: ["quotio"], model: SUPPORTED_MODELS.KIMI_K2_5, variant: undefined },
      { providers: ["quotio"], model: SUPPORTED_MODELS.GPT_5_5, variant: SUPPORTED_VARIANTS.MEDIUM },
    ])
  })
})

// Object-style entry tests
describe("parseFallbackModelEntry (extended)", () => {
  it("parses provider/model string", () => {
    const result = parseFallbackModelEntry("anthropic/claude-sonnet-4-6", undefined)
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
    })
  })

  it("parses model with parenthesized variant", () => {
    const result = parseFallbackModelEntry("anthropic/claude-sonnet-4-6(high)", undefined)
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  it("parses model with space variant", () => {
    const result = parseFallbackModelEntry("openai/gpt-5.4 xhigh", undefined)
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: SUPPORTED_MODELS.GPT_5_4,
      variant: SUPPORTED_VARIANTS.XHIGH,
    })
  })

  it("parses model with minimal space variant", () => {
    const result = parseFallbackModelEntry("openai/gpt-5.4 minimal", undefined)
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: SUPPORTED_MODELS.GPT_5_4,
      variant: "minimal",
    })
  })

  it("uses context provider when no provider prefix", () => {
    const result = parseFallbackModelEntry(SUPPORTED_MODELS.CLAUDE_SONNET_4_6, SUPPORTED_PROVIDERS.ANTHROPIC)
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
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
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
    })
  })

  it("parses object with variant override", () => {
    const result = parseFallbackModelObjectEntry(
      { model: "anthropic/claude-sonnet-4-6", variant: SUPPORTED_VARIANTS.HIGH },
      undefined,
    )
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  it("object variant overrides inline variant", () => {
    const result = parseFallbackModelObjectEntry(
      { model: "anthropic/claude-sonnet-4-6(low)", variant: SUPPORTED_VARIANTS.HIGH },
      undefined,
    )
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  it("carries reasoningEffort and temperature", () => {
    const result = parseFallbackModelObjectEntry(
      {
        model: "openai/gpt-5.4",
        variant: SUPPORTED_VARIANTS.HIGH,
        reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
        temperature: 0.5,
      },
      undefined,
    )
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: SUPPORTED_MODELS.GPT_5_4,
      variant: SUPPORTED_VARIANTS.HIGH,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
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
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      thinking: { type: "enabled", budgetTokens: 10000 },
    })
  })

  it("carries all optional fields", () => {
    const result = parseFallbackModelObjectEntry(
      {
        model: "openai/gpt-5.4",
        variant: SUPPORTED_VARIANTS.XHIGH,
        reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH,
        temperature: 0.3,
        topP: 0.9,
        maxTokens: 8192,
        thinking: { type: "disabled" },
      },
      undefined,
    )
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: SUPPORTED_MODELS.GPT_5_4,
      variant: SUPPORTED_VARIANTS.XHIGH,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH,
      temperature: 0.3,
      topP: 0.9,
      maxTokens: 8192,
      thinking: { type: "disabled" },
    })
  })
})

describe("buildFallbackChainFromModels (mixed)", () => {
  it("handles string input", () => {
    const result = buildFallbackChainFromModels("anthropic/claude-sonnet-4-6", undefined)
    expect(result).toEqual([
      { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
    ])
  })

  it("handles string array", () => {
    const result = buildFallbackChainFromModels(
      ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"],
      undefined,
    )
    expect(result).toEqual([
      { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
    ])
  })

  it("handles mixed array of strings and objects", () => {
    const result = buildFallbackChainFromModels(
      [
        { model: "anthropic/claude-sonnet-4-6", variant: SUPPORTED_VARIANTS.HIGH, reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
        { model: "openai/gpt-5.4", reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH },
        "chutes/kimi-k2.5",
        { model: "chutes/glm-5", temperature: 0.7 },
        "google/gemini-3-flash",
      ],
      undefined,
    )
    expect(result).toEqual([
      { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6, variant: SUPPORTED_VARIANTS.HIGH, reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4, reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH },
      { providers: ["chutes"], model: SUPPORTED_MODELS.KIMI_K2_5 },
      { providers: ["chutes"], model: SUPPORTED_MODELS.GLM_5, temperature: 0.7 },
      { providers: [SUPPORTED_PROVIDERS.GOOGLE], model: SUPPORTED_MODELS.GEMINI_3_FLASH },
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
      { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
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
      { model: "anthropic/claude-sonnet-4-6", variant: SUPPORTED_VARIANTS.HIGH },
    ])).toEqual(["anthropic/claude-sonnet-4-6(high)"])
  })

  it("preserves inline variant when no explicit variant", () => {
    expect(flattenToFallbackModelStrings([
      { model: "anthropic/claude-sonnet-4-6(high)" },
    ])).toEqual(["anthropic/claude-sonnet-4-6(high)"])
  })

  it("explicit variant overrides inline variant (no double-suffix)", () => {
    expect(flattenToFallbackModelStrings([
      { model: "anthropic/claude-sonnet-4-6(low)", variant: SUPPORTED_VARIANTS.HIGH },
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
      { model: "openai/gpt-5.4", variant: SUPPORTED_VARIANTS.HIGH },
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
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: "gpt-5.4-preview" },
    ]
    const result = findMostSpecificFallbackEntry(SUPPORTED_PROVIDERS.OPENAI, "gpt-5.4-preview", chain)
    expect(result?.model).toBe("gpt-5.4-preview")
  })

  it("returns prefix match when no exact match exists", () => {
    const chain = [
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
    ]
    const result = findMostSpecificFallbackEntry(SUPPORTED_PROVIDERS.OPENAI, "gpt-5.4-preview", chain)
    expect(result?.model).toBe(SUPPORTED_MODELS.GPT_5_4)
  })

  it("returns undefined when no entry matches", () => {
    const chain = [
      { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
    ]
    expect(findMostSpecificFallbackEntry(SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_MODELS.GPT_5_4, chain)).toBeUndefined()
  })

  it("sorts by matched prefix length, not insertion order", () => {
    // Both entries share the same provider so both match as prefixes;
    // the longer (more-specific) prefix must win regardless of array order.
    const chain = [
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: "gpt-5" },
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: "gpt-5.4-preview" },
    ]
    const result = findMostSpecificFallbackEntry(SUPPORTED_PROVIDERS.OPENAI, "gpt-5.4-preview-2026", chain)
    expect(result?.model).toBe("gpt-5.4-preview")
  })

  it("is case-insensitive", () => {
    const chain = [
      { providers: ["OpenAI"], model: "GPT-5.4" },
    ]
    const result = findMostSpecificFallbackEntry(SUPPORTED_PROVIDERS.OPENAI, "gpt-5.4-preview", chain)
    expect(result?.model).toBe("GPT-5.4")
  })

  it("preserves variant and settings from matched entry", () => {
    const chain = [
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH, temperature: 0.7 },
      { providers: [SUPPORTED_PROVIDERS.OPENAI], model: "gpt-5.4-preview", variant: "low", reasoningEffort: SUPPORTED_REASONING_EFFORTS.MEDIUM },
    ]
    const result = findMostSpecificFallbackEntry(SUPPORTED_PROVIDERS.OPENAI, "gpt-5.4-preview", chain)
    expect(result).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: "gpt-5.4-preview",
      variant: "low",
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.MEDIUM,
    })
  })
})

// Regression: type-guard against non-string model field (issue #4145).
// Crash signature was `model.trim is not a function` aborting session.processor
// for every provider when a caller forwarded a FallbackModelObject where a
// plain string was expected.
describe("parseFallbackModelEntry: non-string input (issue #4145)", () => {
  test("returns undefined when caller forwards an object instead of a string", () => {
    //#given
    const wrong = { model: "anthropic/claude-opus-4-7", variant: SUPPORTED_VARIANTS.HIGH } as unknown as string

    //#when
    const parsed = parseFallbackModelEntry(wrong, SUPPORTED_PROVIDERS.ANTHROPIC)

    //#then: must not throw, must reject the malformed entry
    expect(parsed).toBeUndefined()
  })

  test("returns undefined for null and undefined", () => {
    //#given
    const nullInput = null as unknown as string
    const undefinedInput = undefined as unknown as string

    //#when / #then
    expect(parseFallbackModelEntry(nullInput, SUPPORTED_PROVIDERS.ANTHROPIC)).toBeUndefined()
    expect(parseFallbackModelEntry(undefinedInput, SUPPORTED_PROVIDERS.ANTHROPIC)).toBeUndefined()
  })

  test("parseFallbackModelObjectEntry returns undefined when nested model field is non-string", () => {
    //#given: FallbackModelObject whose .model was somehow forwarded as a nested
    //object instead of a flat string (issue #4145 reproduction).
    const malformedObject = {
      model: ({ model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 } as unknown) as string,
      variant: SUPPORTED_VARIANTS.HIGH,
    }

    //#when
    const parsed = parseFallbackModelObjectEntry(malformedObject, SUPPORTED_PROVIDERS.ANTHROPIC)

    //#then: must not throw, must reject the malformed entry
    expect(parsed).toBeUndefined()
  })

  test("buildFallbackChainFromModels skips entries whose model is a number", () => {
    //#given
    const fallbackModels = [
      "openai/gpt-5.5",
      (42 as unknown) as string,
    ]

    //#when
    const chain = buildFallbackChainFromModels(fallbackModels, SUPPORTED_PROVIDERS.OPENAI)

    //#then: only the valid string survives, the number is dropped without crashing
    expect(chain).toEqual([
      {
        providers: [SUPPORTED_PROVIDERS.OPENAI],
        model: SUPPORTED_MODELS.GPT_5_5,
        variant: undefined,
      },
    ])
  })
})
