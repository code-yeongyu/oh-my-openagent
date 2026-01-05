import { describe, expect, test } from "bun:test"
import { getModelCapabilities } from "./model-capabilities"

describe("getModelCapabilities", () => {
  test("flags OpenAI reasoning-capable GPT models", () => {
    // #given
    const gpt52 = getModelCapabilities("openai/gpt-5.2")
    const gpt51Codex = getModelCapabilities("openai/gpt-5.1-codex")
    const gpt52NoProvider = getModelCapabilities("gpt-5.2")
    const o3 = getModelCapabilities("o3")

    // #then
    expect(gpt52.supportsReasoningEffort).toBe(true)
    expect(gpt52.supportsTextVerbosity).toBe(true)

    expect(gpt51Codex.supportsReasoningEffort).toBe(true)
    expect(gpt51Codex.supportsTextVerbosity).toBe(true)

    expect(gpt52NoProvider.supportsReasoningEffort).toBe(true)
    expect(gpt52NoProvider.supportsTextVerbosity).toBe(true)

    expect(o3.supportsReasoningEffort).toBe(true)
    expect(o3.supportsTextVerbosity).toBe(true)
  })

  test("treats codex-1 as non-reasoning by default", () => {
    // #given / #then
    const capabilities = getModelCapabilities("openai/codex-1")
    expect(capabilities.supportsReasoningEffort).toBe(false)
    expect(capabilities.supportsThinking).toBe(false)
  })

  test("flags Claude as thinking-capable", () => {
    // #given / #then
    const capabilities = getModelCapabilities("anthropic/claude-opus-4-5")
    expect(capabilities.supportsThinking).toBe(true)
    expect(capabilities.supportsReasoningEffort).toBe(false)
  })
})
