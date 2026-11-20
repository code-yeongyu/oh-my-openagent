import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

const bundledSnapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "test", sourceUrl: "test", models: {} })

describe("GPT-6.1 Sol capabilities", () => {
  test.each(["gpt-6.1-sol", "gpt-6.1-sol-fast"])("%s offers low..max and no none or minimal", (modelID) => {
    const capabilities = getModelCapabilities({ providerID: "openai", modelID, bundledSnapshot })

    expect(capabilities.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(capabilities.maxOutputTokens).toBe(128000)
    expect(capabilities.supportsTemperature).toBe(false)
  })

  test.each(["none", "minimal"])("downgrades %s reasoning effort to low", (effort) => {
    expect(
      resolveCompatibleModelSettings({
        providerID: "chatgpt-subscription",
        modelID: "gpt-6.1-sol",
        desired: { reasoningEffort: effort },
      }).reasoningEffort,
    ).toBe("low")
  })

  test("keeps plain GPT-6 Sol on its own ladder, which still accepts none", () => {
    expect(
      resolveCompatibleModelSettings({
        providerID: "openai",
        modelID: "gpt-6-sol",
        desired: { reasoningEffort: "none" },
      }).reasoningEffort,
    ).toBe("none")
  })
})
