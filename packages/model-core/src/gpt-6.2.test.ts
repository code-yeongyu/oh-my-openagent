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

describe("GPT-6.2 lanes resolve only their exact model (#14155)", () => {
  test.each([
    ["ultrabrain", "gpt-6.2-astra", "max"],
    ["deep-high", "gpt-6.2-astra", "high"],
    ["deep-low", "gpt-6.2-sol", "medium"],
  ])("%s resolves %s at %s beside older and Fast tiers", (category, model, variant) => {
    const registry = [`chatgpt-subscription/${model}`, "chatgpt-subscription/gpt-6-astra", "openai/gpt-6.1-sol"]

    expect(resolveCategory(category, registry)).toMatchObject({ model: `chatgpt-subscription/${model}`, variant })
  })

  test.each(["ultrabrain", "deep-high", "deep-low"])(
    "%s finds no rung on a registry with only older GPT and Copilot models",
    (category) => {
      const registry = ["openai/gpt-6-astra", "openai/gpt-6.1-sol", "openai/gpt-5.6-sol", "github-copilot/gpt-6-astra"]

      expect(resolveCategory(category, registry)).toEqual({ model: "system/default", source: "system-default" })
    },
  )
})
