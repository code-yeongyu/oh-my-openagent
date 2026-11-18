import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import { isGpt6AstraModel } from "./model-family-detectors"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"
import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

const bundledSnapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "test", sourceUrl: "test", models: {} })

const resolveCategory = (category: string, models: readonly string[]) =>
  resolveModelWithFallback({
    fallbackChain: CATEGORY_MODEL_REQUIREMENTS[category]?.fallbackChain ?? [],
    availableModels: new Set(models),
    systemDefaultModel: "system/default",
  })

describe("GPT-6.2 capabilities", () => {
  test.each(["gpt-6.2-astra", "gpt-6.2-astra-fast", "gpt-6.2-sol", "gpt-6.2-sol-fast"])(
    "%s offers low..max with the documented limits",
    (modelID) => {
      const capabilities = getModelCapabilities({ providerID: "openai", modelID, bundledSnapshot })

      expect(capabilities.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"])
      expect(capabilities.maxOutputTokens).toBe(128000)
      expect(capabilities.supportsTemperature).toBe(false)
    },
  )

  test.each([
    ["gpt-6.2-astra", "none"],
    ["gpt-6.2-astra", "minimal"],
    ["gpt-6.2-sol", "none"],
    ["gpt-6.2-sol", "minimal"],
  ])("%s downgrades %s reasoning effort to low", (modelID, effort) => {
    expect(
      resolveCompatibleModelSettings({
        providerID: "chatgpt-subscription",
        modelID,
        desired: { reasoningEffort: effort },
      }).reasoningEffort,
    ).toBe("low")
  })

  test("treats GPT-6.2 Astra as the Astra tier and GPT-6.2 Sol as not", () => {
    expect(isGpt6AstraModel("chatgpt-subscription/gpt-6.2-astra")).toBe(true)
    expect(isGpt6AstraModel("openai/gpt-6.2-astra-fast")).toBe(true)
    expect(isGpt6AstraModel("chatgpt-subscription/gpt-6.2-sol")).toBe(false)
  })
})

describe("GPT-6.2 lanes with and without 6.2 in the registry", () => {
  test("deep-low resolves gpt-6.2-sol at medium when the registry serves it beside 6.1 Sol", () => {
    expect(
      resolveCategory("deep-low", ["chatgpt-subscription/gpt-6.2-sol", "chatgpt-subscription/gpt-6.1-sol"]),
    ).toMatchObject({ model: "chatgpt-subscription/gpt-6.2-sol", variant: "medium" })
  })

  test("deep-low keeps gpt-6.1-sol at medium on a registry without 6.2", () => {
    expect(
      resolveCategory("deep-low", ["chatgpt-subscription/gpt-6.1-sol", "chatgpt-subscription/gpt-5.6-sol"]),
    ).toMatchObject({ model: "chatgpt-subscription/gpt-6.1-sol", variant: "medium" })
  })

  test("deep-high resolves gpt-6.2-astra at high, and gpt-6-astra at high without 6.2", () => {
    expect(resolveCategory("deep-high", ["openai/gpt-6.2-astra", "openai/gpt-6-astra"])).toMatchObject({
      model: "openai/gpt-6.2-astra",
      variant: "high",
    })
    expect(resolveCategory("deep-high", ["openai/gpt-6-astra"])).toMatchObject({
      model: "openai/gpt-6-astra",
      variant: "high",
    })
  })

  test("ultrabrain keeps Copilot on gpt-6-astra max", () => {
    expect(resolveCategory("ultrabrain", ["github-copilot/gpt-6-astra"])).toMatchObject({
      model: "github-copilot/gpt-6-astra",
      variant: "max",
    })
  })
})
