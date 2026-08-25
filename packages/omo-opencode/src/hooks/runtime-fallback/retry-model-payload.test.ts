import { describe, test, expect } from "bun:test"
import { buildRetryModelPayload } from "./retry-model-payload"

describe("buildRetryModelPayload", () => {
  test("should return undefined for empty model string", () => {
    // given
    const model = ""

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toBeUndefined()
  })

  test("should return undefined for model without provider prefix", () => {
    // given
    const model = "kimi-k2.5"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toBeUndefined()
  })

  test("should parse provider and model ID", () => {
    // given
    const model = "chutes/kimi-k2.5"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: "kimi-k2.5" },
    })
  })

  test("should include variant from model string", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5 high"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      variant: "high",
    })
  })

  test("should use agent variant when model string has no variant", () => {
    // given
    const model = "chutes/kimi-k2.5"
    const agentSettings = { variant: "max" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: "kimi-k2.5" },
      variant: "max",
    })
  })

  test("should prefer model string variant over agent variant", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5 high"
    const agentSettings = { variant: "max" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      variant: "high",
    })
  })

  test("should include reasoningEffort from agent settings", () => {
    // given
    const model = "openai/gpt-5.4"
    const agentSettings = { variant: "high", reasoningEffort: "xhigh" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4" },
      variant: "high",
      reasoningEffort: "xhigh",
    })
  })

  test("should not include reasoningEffort when agent settings has none", () => {
    // given
    const model = "chutes/kimi-k2.5"
    const agentSettings = { variant: "medium" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: "kimi-k2.5" },
      variant: "medium",
    })
  })

  test("should lower unsupported configured reasoning to reasoningEffort", () => {
    // given
    const model = "test-provider/test-model"
    const agentSettings = { reasoning: "high" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "test-provider", modelID: "test-model" },
      reasoningEffort: "high",
    })
  })

  test("should preserve explicit reasoningEffort alongside an inline model variant", () => {
    // given
    const model = "openai/gpt-5.4 medium"
    const agentSettings = { reasoning: "high", reasoningEffort: "xhigh" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4" },
      variant: "medium",
      reasoningEffort: "xhigh",
    })
  })

  test("should let an explicit model variant suppress inherited reasoning", () => {
    // given
    const model = "test-provider/test-model medium"
    const agentSettings = { reasoning: "high" }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "test-provider", modelID: "test-model" },
      variant: "medium",
    })
  })
})
