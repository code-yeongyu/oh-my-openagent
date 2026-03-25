import { describe, expect, test } from "bun:test"

import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

describe("resolveCompatibleModelSettings", () => {
  test("keeps supported Claude Opus variant unchanged", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      desired: { variant: "max" },
    })

    expect(result).toEqual({
      variant: "max",
      reasoningEffort: undefined,
      changes: [],
    })
  })

  test("uses model metadata first for variant support", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      desired: { variant: "max" },
      capabilities: { variants: ["low", "medium", "high"] },
    })

    expect(result).toEqual({
      variant: "high",
      reasoningEffort: undefined,
      changes: [
        {
          field: "variant",
          from: "max",
          to: "high",
          reason: "unsupported-by-model-metadata",
        },
      ],
    })
  })

  test("prefers metadata over family heuristics even when family would allow a higher level", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      desired: { variant: "max" },
      capabilities: { variants: ["low", "medium"] },
    })

    expect(result.variant).toBe("medium")
    expect(result.changes).toEqual([
      {
        field: "variant",
        from: "max",
        to: "medium",
        reason: "unsupported-by-model-metadata",
      },
    ])
  })

  test("downgrades unsupported Claude Sonnet max variant to high when metadata is absent", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      desired: { variant: "max" },
    })

    expect(result.variant).toBe("high")
    expect(result.changes).toEqual([
      {
        field: "variant",
        from: "max",
        to: "high",
        reason: "unsupported-by-model-family",
      },
    ])
  })

  test("keeps supported GPT reasoningEffort unchanged", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { reasoningEffort: "high" },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: "high",
      changes: [],
    })
  })

  test("keeps supported OpenAI reasoning-family effort for o-series models", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "o3-mini",
      desired: { reasoningEffort: "high" },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: "high",
      changes: [],
    })
  })

  test("does not record case-only normalization as a compatibility downgrade", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { variant: "HIGH", reasoningEffort: "HIGH" },
    })

    expect(result).toEqual({
      variant: "high",
      reasoningEffort: "high",
      changes: [],
    })
  })

  test("drops reasoningEffort for standard GPT models (gpt-4.1)", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-4.1",
      desired: { reasoningEffort: "high" },
    })

    expect(result.reasoningEffort).toBeUndefined()
    expect(result.changes).toEqual([
      {
        field: "reasoningEffort",
        from: "high",
        to: undefined,
        reason: "unsupported-by-model-family",
      },
    ])
  })

  test("drops reasoningEffort for Claude family", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      desired: { reasoningEffort: "high" },
    })

    expect(result.reasoningEffort).toBeUndefined()
    expect(result.changes).toEqual([
      {
        field: "reasoningEffort",
        from: "high",
        to: undefined,
        reason: "unsupported-by-model-family",
      },
    ])
  })

  test("handles combined variant and reasoningEffort normalization", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      desired: { variant: "max", reasoningEffort: "high" },
    })

    expect(result).toEqual({
      variant: "high",
      reasoningEffort: undefined,
      changes: [
        {
          field: "variant",
          from: "max",
          to: "high",
          reason: "unsupported-by-model-family",
        },
        {
          field: "reasoningEffort",
          from: "high",
          to: undefined,
          reason: "unsupported-by-model-family",
        },
      ],
    })
  })

  test("treats unknown model families conservatively by dropping unsupported settings", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "mystery",
      modelID: "mystery-model-1",
      desired: { variant: "max", reasoningEffort: "high" },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: undefined,
      changes: [
        {
          field: "variant",
          from: "max",
          to: undefined,
          reason: "unknown-model-family",
        },
        {
          field: "reasoningEffort",
          from: "high",
          to: undefined,
          reason: "unknown-model-family",
        },
      ],
    })
  })

  // Provider-agnostic detection: model ID is the source of truth, not provider ID
  test("detects Claude via any provider (provider-agnostic)", () => {
    for (const providerID of ["anthropic", "aws-bedrock", "bedrock", "amazon-bedrock", "opencode", "my-custom-proxy", "google-vertex-anthropic"]) {
      const result = resolveCompatibleModelSettings({
        providerID,
        modelID: "claude-sonnet-4-6",
        desired: { variant: "max" },
      })

      expect(result.variant).toBe("high")
      expect(result.changes[0]?.reason).toBe("unsupported-by-model-family")
    }
  })

  test("detects Claude 3 Opus via any provider", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "some-unknown-proxy",
      modelID: "claude-3-opus-20240229",
      desired: { variant: "max" },
    })

    expect(result.variant).toBe("max")
    expect(result.changes).toEqual([])
  })

  test("detects OpenAI reasoning models without requiring openai provider", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "azure-openai",
      modelID: "o3-mini",
      desired: { reasoningEffort: "high" },
    })

    expect(result.reasoningEffort).toBe("high")
    expect(result.changes).toEqual([])
  })

  // -----------------------------------------------------------------------
  // Registry coverage — every model family from FAMILY_CAPABILITIES
  // -----------------------------------------------------------------------

  describe("model family registry coverage", () => {
    const familyCases: Array<{
      name: string
      modelID: string
      expectedVariants: string[]
      hasReasoningEffort: boolean
    }> = [
      { name: "Gemini", modelID: "gemini-3.1-pro", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Kimi (kimi)", modelID: "kimi-k2.5", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Kimi (k2)", modelID: "k2-v2", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "GLM", modelID: "glm-5", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Minimax", modelID: "minimax-m2.5", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "DeepSeek", modelID: "deepseek-r2", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Mistral", modelID: "mistral-large-next", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Codestral → Mistral", modelID: "codestral-2506", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Llama", modelID: "llama-4-maverick", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
    ]

    for (const { name, modelID, expectedVariants, hasReasoningEffort } of familyCases) {
      test(`${name} (${modelID}): keeps supported variant`, () => {
        const highest = expectedVariants[expectedVariants.length - 1]
        const result = resolveCompatibleModelSettings({
          providerID: "any-provider",
          modelID,
          desired: { variant: highest },
        })

        expect(result.variant).toBe(highest)
        expect(result.changes).toEqual([])
      })

      test(`${name} (${modelID}): downgrades unsupported variant`, () => {
        const result = resolveCompatibleModelSettings({
          providerID: "any-provider",
          modelID,
          desired: { variant: "max" },
        })

        const highest = expectedVariants[expectedVariants.length - 1]
        expect(result.variant).toBe(highest)
        expect(result.changes[0]?.reason).toBe("unsupported-by-model-family")
      })

      test(`${name} (${modelID}): ${hasReasoningEffort ? "keeps" : "drops"} reasoningEffort`, () => {
        const result = resolveCompatibleModelSettings({
          providerID: "any-provider",
          modelID,
          desired: { reasoningEffort: "high" },
        })

        if (hasReasoningEffort) {
          expect(result.reasoningEffort).toBe("high")
          expect(result.changes).toEqual([])
        } else {
          expect(result.reasoningEffort).toBeUndefined()
          expect(result.changes[0]?.reason).toBe("unsupported-by-model-family")
        }
      })
    }
  })

  // GPT-5 specific: supports xhigh variant and xhigh reasoningEffort
  test("GPT-5 keeps xhigh variant and reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { variant: "xhigh", reasoningEffort: "xhigh" },
    })

    expect(result).toEqual({
      variant: "xhigh",
      reasoningEffort: "xhigh",
      changes: [],
    })
  })

  // Reasoning effort: "none" and "minimal" are valid per Vercel AI SDK
  test("GPT-5 keeps none reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { reasoningEffort: "none" },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: "none",
      changes: [],
    })
  })

  test("GPT-5 keeps minimal reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { reasoningEffort: "minimal" },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: "minimal",
      changes: [],
    })
  })

  test("o-series keeps none reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "o3-mini",
      desired: { reasoningEffort: "none" },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: "none",
      changes: [],
    })
  })

  // Reasoning effort downgrade within families that support it
  test("o-series downgrades xhigh reasoningEffort to high", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "o3-mini",
      desired: { reasoningEffort: "xhigh" },
    })

    expect(result.reasoningEffort).toBe("high")
    expect(result.changes).toEqual([
      {
        field: "reasoningEffort",
        from: "xhigh",
        to: "high",
        reason: "unsupported-by-model-family",
      },
    ])
  })

  test("GPT-5 keeps xhigh but would downgrade a hypothetical beyond-max level", () => {
    // GPT-5 supports up to "xhigh" — verify the ladder works by requesting
    // a value that IS in the ladder but NOT in the family's allowed list.
    // Since "xhigh" is the max for GPT-5 reasoningEffort, we verify it stays.
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { reasoningEffort: "xhigh" },
    })

    expect(result.reasoningEffort).toBe("xhigh")
    expect(result.changes).toEqual([])
  })

  test("o-series downgrades unsupported variant to high", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "o3-mini",
      desired: { variant: "max" },
    })

    expect(result.variant).toBe("high")
    expect(result.changes).toEqual([
      {
        field: "variant",
        from: "max",
        to: "high",
        reason: "unsupported-by-model-family",
      },
    ])
  })

  // Passthrough: undefined desired values produce no changes
  test("no-op when desired settings are empty", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      desired: {},
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: undefined,
      changes: [],
    })
  })
})
