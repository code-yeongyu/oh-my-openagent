describe("buildMultimodalLookerFallbackChain", () => {
  it("preserves hardcoded variant metadata when dynamic and hardcoded entries share the same model", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [
      { providerID: "openai", modelID: "gpt-5.4" },
      { providerID: "opencode", modelID: "gpt-5.4" },
    ]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)
    const matchingEntries = result.filter((entry) => entry.model === "gpt-5.4")

    // then
    expect(matchingEntries).toHaveLength(1)
    expect(matchingEntries[0]).toEqual({
      providers: ["openai", "opencode"],
      model: "gpt-5.4",
      variant: "medium",
    })
  })

  it("merges missing hardcoded providers into an existing dynamic entry", async () => {
    // given
    const { buildMultimodalLookerFallbackChain } = await import("./multimodal-fallback-chain")
    const visionCapableModels = [{ providerID: "openai", modelID: "gpt-5.4" }]

    // when
    const result = buildMultimodalLookerFallbackChain(visionCapableModels)

    // then
    expect(result[0]).toEqual({
      providers: ["openai", "opencode"],
      model: "gpt-5.4",
      variant: "medium",
    })
  })
})
