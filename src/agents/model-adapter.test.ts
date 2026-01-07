import { describe, expect, test } from "bun:test"
import { DEFAULT_PROMPT_DIALECT, GPT_PROMPT_DIALECT, getModelAdapter, getModelCapabilities, getPromptDialect } from "./model-adapter"

describe("model adapter", () => {
  test("matches OpenAI family models", () => {
    // #given / #then
    expect(getModelAdapter("openai/gpt-5.2").id).toBe("openai-family")
    expect(getModelAdapter("gpt-5.2").id).toBe("openai-family")
    expect(getModelAdapter("openai/codex-1").id).toBe("openai-family")
    expect(getModelAdapter("codex-1").id).toBe("openai-family")
    expect(getModelAdapter("o3").id).toBe("openai-family")
  })

  test("matches Claude family models", () => {
    // #given / #then
    expect(getModelAdapter("anthropic/claude-opus-4-5").id).toBe("claude-family")
  })

  test("falls back to default for other providers", () => {
    // #given / #then
    expect(getModelAdapter("google/gemini-3-pro").id).toBe("default")
  })

  test("returns prompt dialect per adapter", () => {
    // #given / #then
    expect(getPromptDialect("openai/codex-1")).toEqual(GPT_PROMPT_DIALECT)
    expect(getPromptDialect("anthropic/claude-opus-4-5")).toEqual(DEFAULT_PROMPT_DIALECT)
  })

  test("returns capabilities per adapter", () => {
    // #given
    const gpt = getModelCapabilities("openai/gpt-5.2")
    const codex = getModelCapabilities("openai/codex-1")
    const claude = getModelCapabilities("anthropic/claude-opus-4-5")

    // #then
    expect(gpt.supportsReasoningEffort).toBe(true)
    expect(gpt.supportsTextVerbosity).toBe(true)
    expect(gpt.supportsThinking).toBe(false)

    expect(codex.supportsReasoningEffort).toBe(false)
    expect(codex.supportsTextVerbosity).toBe(false)
    expect(codex.supportsThinking).toBe(false)

    expect(claude.supportsReasoningEffort).toBe(false)
    expect(claude.supportsTextVerbosity).toBe(false)
    expect(claude.supportsThinking).toBe(true)
  })

  test("default implementation policy uses explicit wording", () => {
    // #given / #then
    expect(DEFAULT_PROMPT_DIALECT.implementationPolicy).toContain("EXPLICITLY")
  })
})
