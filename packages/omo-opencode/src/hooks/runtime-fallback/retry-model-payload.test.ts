import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS , SUPPORTED_REASONING_EFFORTS } from "@oh-my-opencode/model-core";
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
    const model = SUPPORTED_MODELS.KIMI_K2_5

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
      model: { providerID: "chutes", modelID: SUPPORTED_MODELS.KIMI_K2_5 },
    })
  })

  test("should include variant from model string", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5 high"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toEqual({
      model: { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-sonnet-4-5" },
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  test("should use agent variant when model string has no variant", () => {
    // given
    const model = "chutes/kimi-k2.5"
    const agentSettings = { variant: SUPPORTED_VARIANTS.MAX }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: SUPPORTED_MODELS.KIMI_K2_5 },
      variant: SUPPORTED_VARIANTS.MAX,
    })
  })

  test("should prefer model string variant over agent variant", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5 high"
    const agentSettings = { variant: SUPPORTED_VARIANTS.MAX }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-sonnet-4-5" },
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  test("should include reasoningEffort from agent settings", () => {
    // given
    const model = "openai/gpt-5.4"
    const agentSettings = { variant: SUPPORTED_VARIANTS.HIGH, reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_4 },
      variant: SUPPORTED_VARIANTS.HIGH,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH,
    })
  })

  test("should not include reasoningEffort when agent settings has none", () => {
    // given
    const model = "chutes/kimi-k2.5"
    const agentSettings = { variant: SUPPORTED_VARIANTS.MEDIUM }

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: SUPPORTED_MODELS.KIMI_K2_5 },
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
  })
})
