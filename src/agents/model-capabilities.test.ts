import { describe, expect, test } from "bun:test"
import { getModelCapabilities } from "./model-capabilities"

describe("getModelCapabilities", () => {
  test("flags OpenAI reasoning-capable GPT models", () => {
    // #given / #then
    expect(getModelCapabilities("openai/gpt-5.2").supportsReasoningEffort).toBe(true)
    expect(getModelCapabilities("openai/gpt-5.1-codex").supportsReasoningEffort).toBe(true)
    expect(getModelCapabilities("gpt-5.2").supportsReasoningEffort).toBe(true)
    expect(getModelCapabilities("o3").supportsReasoningEffort).toBe(true)
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
