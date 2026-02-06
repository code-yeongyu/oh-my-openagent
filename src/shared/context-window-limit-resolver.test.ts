import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resolveContextWindowLimit, isAnthropicProvider } from "./context-window-limit-resolver"

describe("resolveContextWindowLimit", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_1M_CONTEXT
    delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_1M_CONTEXT
    delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
  })

  test("returns explicit contextWindowLimit override when provided", () => {
    //#given
    process.env.ANTHROPIC_1M_CONTEXT = "true"
    const modelContextLimitsCache = new Map<string, number>([
      ["anthropic/claude-opus-4-6", 320_000],
    ])

    //#when
    const result = resolveContextWindowLimit({
      contextWindowLimit: 500_000,
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      modelContextLimitsCache,
    })

    //#then
    expect(result).toBe(500_000)
  })

  test("returns 1_000_000 when ANTHROPIC_1M_CONTEXT=true and no override/cache", () => {
    //#given
    process.env.ANTHROPIC_1M_CONTEXT = "true"

    //#when
    const result = resolveContextWindowLimit({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    })

    //#then
    expect(result).toBe(1_000_000)
  })

  test("returns 1_000_000 when VERTEX_ANTHROPIC_1M_CONTEXT=true", () => {
    //#given
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT = "true"

    //#when
    const result = resolveContextWindowLimit({
      providerID: "vertex-anthropic",
      modelID: "claude-opus-4-6",
    })

    //#then
    expect(result).toBe(1_000_000)
  })

  test("returns model-specific cache value when cache has providerID/modelID entry", () => {
    //#given
    const modelContextLimitsCache = new Map<string, number>([
      ["anthropic/claude-opus-4-6", 333_333],
    ])

    //#when
    const result = resolveContextWindowLimit({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      modelContextLimitsCache,
    })

    //#then
    expect(result).toBe(333_333)
  })

  test("returns default 200_000 when no override, no env var, no cache hit", () => {
    //#given
    const modelContextLimitsCache = new Map<string, number>()

    //#when
    const result = resolveContextWindowLimit({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      modelContextLimitsCache,
    })

    //#then
    expect(result).toBe(200_000)
  })

  test("returns default 200_000 when cache has entry for different model", () => {
    //#given
    const modelContextLimitsCache = new Map<string, number>([
      ["anthropic/claude-sonnet-4-5", 300_000],
    ])

    //#when
    const result = resolveContextWindowLimit({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      modelContextLimitsCache,
    })

    //#then
    expect(result).toBe(200_000)
  })

  test("env var takes precedence over model cache", () => {
    //#given
    process.env.ANTHROPIC_1M_CONTEXT = "true"
    const modelContextLimitsCache = new Map<string, number>([
      ["anthropic/claude-opus-4-6", 333_333],
    ])

    //#when
    const result = resolveContextWindowLimit({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      modelContextLimitsCache,
    })

    //#then
    expect(result).toBe(1_000_000)
  })
})

describe("isAnthropicProvider", () => {
  test("returns true for 'anthropic'", () => {
    expect(isAnthropicProvider("anthropic")).toBe(true)
  })

  test("returns true for 'vertex-anthropic'", () => {
    expect(isAnthropicProvider("vertex-anthropic")).toBe(true)
  })

  test("returns false for 'openai'", () => {
    expect(isAnthropicProvider("openai")).toBe(false)
  })

  test("returns false for undefined", () => {
    expect(isAnthropicProvider(undefined)).toBe(false)
  })

  test("returns false for empty string", () => {
    expect(isAnthropicProvider("")).toBe(false)
  })
})
