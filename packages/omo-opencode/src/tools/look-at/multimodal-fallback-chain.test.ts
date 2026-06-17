import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "@oh-my-opencode/model-core";
import { describe, expect, it } from "bun:test"

describe("buildMultimodalLookerFallbackChain", () => {
  it("builds fallback chain from vision-capable models", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [
      { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 },
      { providerID: "opencode", modelID: SUPPORTED_MODELS.GPT_5_5 },
    ]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)

    // then
    const gpt55Entries = result.filter((entry) => entry.model === SUPPORTED_MODELS.GPT_5_5)
    expect(gpt55Entries.length).toBeGreaterThan(0)
  })

  it("avoids duplicates when adding hardcoded entries", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [{ providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)

    // then
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].model).toBe(SUPPORTED_MODELS.GPT_5_5)
    expect(result[0].providers).toContain(SUPPORTED_PROVIDERS.OPENAI)
  })

  it("preserves hardcoded variant metadata for cache-derived entries", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [{ providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)

    // then
    expect(result[0]).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
  })
})
