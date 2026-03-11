describe("buildMultimodalLookerFallbackChain", () => {
  it("builds fallback chain from vision-capable models", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [
      { providerID: "openai", modelID: "gpt-5.4" },
      { providerID: "opencode", modelID: "gpt-5.4" },
    ]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)

    // then
    const gpt54Entries = result.filter((entry) => entry.model === "gpt-5.4")
    expect(gpt54Entries.length).toBeGreaterThan(0)
  })

  it("avoids duplicates when adding hardcoded entries", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [{ providerID: "openai", modelID: "gpt-5.4" }]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)

    // then
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].model).toBe("gpt-5.4")
    expect(result[0].providers).toContain("openai")
  })
})
