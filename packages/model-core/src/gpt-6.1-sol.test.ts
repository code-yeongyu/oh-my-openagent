import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"
import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

const bundledSnapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "test", sourceUrl: "test", models: {} })

const deepLow = (models: readonly string[]) =>
  resolveModelWithFallback({
    fallbackChain: CATEGORY_MODEL_REQUIREMENTS["deep-low"].fallbackChain,
    availableModels: new Set(models),
    systemDefaultModel: "system/default",
  })

describe("GPT-6.1 Sol capabilities", () => {
  test.each(["gpt-6.1-sol", "gpt-6.1-sol-fast"])("%s offers low..max and no none or minimal", (modelID) => {
    const capabilities = getModelCapabilities({ providerID: "openai", modelID, bundledSnapshot })

    expect(capabilities.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(capabilities.maxOutputTokens).toBe(128000)
    expect(capabilities.supportsTemperature).toBe(false)
  })

  test.each(["none", "minimal"])("downgrades %s reasoning effort to low", (effort) => {
    expect(resolveCompatibleModelSettings({
      providerID: "chatgpt-subscription",
      modelID: "gpt-6.1-sol",
      desired: { reasoningEffort: effort },
    }).reasoningEffort).toBe("low")
  })

  test("keeps plain GPT-6 Sol on its own ladder, which still accepts none", () => {
    expect(resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-6-sol",
      desired: { reasoningEffort: "none" },
    }).reasoningEffort).toBe("none")
  })
})

describe("deep-low on GPT-6.1 Sol", () => {
  test("resolves gpt-6.1-sol at medium when the registry serves both 6.1 Sol and 5.6 Sol", () => {
    expect(deepLow(["chatgpt-subscription/gpt-6.1-sol", "chatgpt-subscription/gpt-5.6-sol"])).toMatchObject({
      model: "chatgpt-subscription/gpt-6.1-sol",
      variant: "medium",
    })
  })

  test("falls to the 6.1 Fast tier before leaving the 6.1 family", () => {
    expect(deepLow(["openai/gpt-6.1-sol-fast", "openai/gpt-5.6-sol"])).toMatchObject({
      model: "openai/gpt-6.1-sol-fast",
      variant: "medium",
    })
  })

  test("still resolves gpt-5.6-sol at medium on a registry without 6.1 Sol", () => {
    expect(deepLow(["github-copilot/gpt-5.6-sol"])).toMatchObject({ model: "github-copilot/gpt-5.6-sol", variant: "medium" })
  })
})
