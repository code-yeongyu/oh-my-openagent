import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS, SUPPORTED_REASONING_EFFORTS, type Variant } from "./registry";
import { describe, expect, test } from "bun:test"

import { getModelCapabilities } from "./model-capabilities"
import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

describe("resolveCompatibleModelSettings", () => {
  test("keeps supported Claude Opus variant unchanged", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      desired: { variant: SUPPORTED_VARIANTS.MAX },
    })

    expect(result).toEqual({
      variant: SUPPORTED_VARIANTS.MAX,
      reasoningEffort: undefined,
      changes: [],
    })
  })

  test("uses model metadata first for variant support", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      desired: { variant: SUPPORTED_VARIANTS.MAX },
      capabilities: { variants: ["low", "medium", "high"] },
    })

    expect(result).toEqual({
      variant: SUPPORTED_VARIANTS.HIGH,
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
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      desired: { variant: SUPPORTED_VARIANTS.MAX },
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
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      desired: { variant: SUPPORTED_VARIANTS.MAX },
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
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
      changes: [],
    })
  })

  test("keeps supported OpenAI reasoning-family effort for o-series models", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: "o3-mini",
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
      changes: [],
    })
  })

  test("does not record case-only normalization as a compatibility downgrade", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { variant: "high", reasoningEffort: "HIGH" },
    })

    expect(result).toEqual({
      variant: SUPPORTED_VARIANTS.HIGH,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
      changes: [],
    })
  })

  test("drops reasoningEffort for standard GPT models (gpt-4.1)", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: "gpt-4.1",
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
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
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
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
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
      desired: { variant: SUPPORTED_VARIANTS.MAX, reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
    })

    expect(result).toEqual({
      variant: SUPPORTED_VARIANTS.HIGH,
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
      providerID: SUPPORTED_PROVIDERS.MYSTERY,
      modelID: SUPPORTED_MODELS.MYSTERY_MODEL_1,
      desired: { variant: SUPPORTED_VARIANTS.MAX, reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
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
    for (const providerID of [SUPPORTED_PROVIDERS.ANTHROPIC, "aws-bedrock", "bedrock", "amazon-bedrock", "opencode", "my-custom-proxy", "google-vertex-anthropic"]) {
      const result = resolveCompatibleModelSettings({
        providerID,
        modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
        desired: { variant: SUPPORTED_VARIANTS.MAX },
      })

      expect(result.variant).toBe("high")
      expect(result.changes[0]?.reason).toBe("unsupported-by-model-family")
    }
  })

  test("detects Claude 3 Opus via any provider", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "some-unknown-proxy",
      modelID: "claude-3-opus-20240229",
      desired: { variant: SUPPORTED_VARIANTS.MAX },
    })

    expect(result.variant).toBe("max")
    expect(result.changes).toEqual([])
  })

  test("detects OpenAI reasoning models without requiring openai provider", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "azure-openai",
      modelID: "o3-mini",
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
    })

    expect(result.reasoningEffort).toBe("high")
    expect(result.changes).toEqual([])
  })

  describe("model family registry coverage", () => {
    const familyCases: Array<{
      name: string
      modelID: string
      expectedVariants: string[]
      hasReasoningEffort: boolean
    }> = [
      { name: "Gemini", modelID: SUPPORTED_MODELS.GEMINI_3_1_PRO, expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Grok", modelID: "grok-4.3", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: true },
      { name: "Kimi (kimi)", modelID: SUPPORTED_MODELS.KIMI_K2_5, expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Kimi (k2)", modelID: "k2-v2", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "GLM", modelID: SUPPORTED_MODELS.GLM_5, expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "Minimax", modelID: "minimax-m2.5", expectedVariants: ["low", "medium", "high"], hasReasoningEffort: false },
      { name: "DeepSeek", modelID: "deepseek-r2", expectedVariants: ["low", "medium", "high", "max"], hasReasoningEffort: true },
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
          desired: { variant: highest as Variant },
        })

        expect(result.variant).toBe(highest as Variant)
        expect(result.changes).toEqual([])
      })

      test(`${name} (${modelID}): downgrades unsupported variant`, () => {
        const supportsMax = expectedVariants.includes("max")
        const desiredVariant = supportsMax ? "xhigh" : "max"
        const expectedDowngrade = supportsMax
          ? "high"
          : expectedVariants[expectedVariants.length - 1]

        const result = resolveCompatibleModelSettings({
          providerID: "any-provider",
          modelID,
          desired: { variant: desiredVariant as Variant },
        })

        expect(result.variant).toBe(expectedDowngrade as Variant)
        expect(result.changes[0]?.reason).toBe("unsupported-by-model-family")
      })

      test(`${name} (${modelID}): ${hasReasoningEffort ? "keeps" : "drops"} reasoningEffort`, () => {
        const result = resolveCompatibleModelSettings({
          providerID: "any-provider",
          modelID,
          desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH },
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

  test("GPT-5 keeps xhigh variant and reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { variant: SUPPORTED_VARIANTS.XHIGH, reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH },
    })

    expect(result).toEqual({
      variant: SUPPORTED_VARIANTS.XHIGH,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH,
      changes: [],
    })
  })

  test("GitHub Copilot GPT-5 high-tier variants downgrade to high", () => {
    for (const modelID of [SUPPORTED_MODELS.GPT_5_4, SUPPORTED_MODELS.GPT_5_5]) {
      for (const requested of ["xhigh", "max"]) {
        const capabilities = getModelCapabilities({
          providerID: SUPPORTED_PROVIDERS.GITHUB_COPILOT,
          modelID,
        })
        const result = resolveCompatibleModelSettings({
          providerID: SUPPORTED_PROVIDERS.GITHUB_COPILOT,
          modelID,
          desired: { variant: requested as Variant, reasoningEffort: requested },
          capabilities,
        })

        expect(result).toEqual({
          variant: SUPPORTED_VARIANTS.HIGH,
          reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
          changes: [
            {
              field: "variant",
              from: requested,
              to: "high",
              reason: "unsupported-by-model-metadata",
            },
            {
              field: "reasoningEffort",
              from: requested,
              to: "high",
              reason: "unsupported-by-model-metadata",
            },
          ],
        })
      }
    }
  })
  test("DeepSeek keeps canonical high and max reasoningEffort values", () => {
    for (const reasoningEffort of ["high", "max"]) {
      const result = resolveCompatibleModelSettings({
        providerID: "openai-compatible",
        modelID: "deepseek-v4-pro",
        desired: { reasoningEffort },
      })

      expect(result.reasoningEffort).toBe(reasoningEffort)
      expect(result.changes).toEqual([])
    }
  })

  test("DeepSeek maps generic reasoningEffort levels to canonical API values", () => {
    const cases = [
      { requested: "low", expected: "high" },
      { requested: "medium", expected: "high" },
      { requested: "xhigh", expected: "max" },
    ]

    for (const { requested, expected } of cases) {
      const result = resolveCompatibleModelSettings({
        providerID: "openai-compatible",
        modelID: "deepseek-v4-pro",
        desired: { reasoningEffort: requested },
      })

      expect(result.reasoningEffort).toBe(expected)
      expect(result.changes).toEqual([
        {
          field: "reasoningEffort",
          from: requested,
          to: expected,
          reason: "unsupported-by-model-family",
        },
      ])
    }
  })

  test("DeepSeek maps generic reasoningEffort levels when capabilities come from heuristics", () => {
    const capabilities = getModelCapabilities({
      providerID: "openai-compatible",
      modelID: "deepseek-v4-pro",
    })
    const result = resolveCompatibleModelSettings({
      providerID: "openai-compatible",
      modelID: "deepseek-v4-pro",
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH },
      capabilities,
    })

    expect(result.reasoningEffort).toBe("max")
    expect(result.changes).toEqual([
      {
        field: "reasoningEffort",
        from: "xhigh",
        to: "max",
        reason: "unsupported-by-model-family",
      },
    ])
  })

  test("GPT-5 downgrades unsupported max variant to xhigh", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { variant: SUPPORTED_VARIANTS.MAX },
    })

    expect(result).toEqual({
      variant: SUPPORTED_VARIANTS.XHIGH,
      reasoningEffort: undefined,
      changes: [
        {
          field: "variant",
          from: "max",
          to: "xhigh",
          reason: "unsupported-by-model-family",
        },
      ],
    })
  })

  test("GPT-5 keeps none reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.NONE },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.NONE,
      changes: [],
    })
  })

  test("GPT-5 keeps minimal reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.MINIMAL },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.MINIMAL,
      changes: [],
    })
  })

  test("o-series keeps none reasoningEffort", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: "o3-mini",
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.NONE },
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: SUPPORTED_REASONING_EFFORTS.NONE,
      changes: [],
    })
  })

  test("o-series downgrades xhigh reasoningEffort to high", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: "o3-mini",
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH },
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
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { reasoningEffort: SUPPORTED_REASONING_EFFORTS.XHIGH },
    })

    expect(result.reasoningEffort).toBe("xhigh")
    expect(result.changes).toEqual([])
  })

  test("o-series downgrades unsupported variant to high", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: "o3-mini",
      desired: { variant: SUPPORTED_VARIANTS.MAX },
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

  test("drops unsupported temperature when capability metadata disables it", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { temperature: 0.7 },
      capabilities: { supportsTemperature: false },
    })

    expect(result.temperature).toBeUndefined()
    expect(result.changes).toEqual([
      {
        field: "temperature",
        from: "0.7",
        to: undefined,
        reason: "unsupported-by-model-metadata",
      },
    ])
  })

  test("drops thinking when model capabilities say it is unsupported", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { thinking: { type: "enabled", budgetTokens: 4096 } },
      capabilities: { supportsThinking: false },
    })

    expect(result.thinking).toBeUndefined()
    expect(result.changes).toEqual([
      {
        field: "thinking",
        from: "{\"type\":\"enabled\",\"budgetTokens\":4096}",
        to: undefined,
        reason: "unsupported-by-model-metadata",
      },
    ])
  })

  test("drops thinking for MiniMax M2.7 capabilities resolved from heuristics", () => {
    // given
    const capabilities = getModelCapabilities({
      providerID: "volcengine",
      modelID: SUPPORTED_MODELS.MINIMAX_M2_7,
    })

    // when
    const result = resolveCompatibleModelSettings({
      providerID: "volcengine",
      modelID: SUPPORTED_MODELS.MINIMAX_M2_7,
      desired: { thinking: { type: "enabled", budgetTokens: 4096 } },
      capabilities,
    })

    // then
    expect(result.thinking).toBeUndefined()
    expect(result.changes[0]?.field).toBe("thinking")
    expect(result.changes[0]?.reason).toBe("unsupported-by-model-metadata")
  })

  test("drops thinking for non-thinking Kimi K2.6 capabilities resolved from heuristics", () => {
    // given
    const capabilities = getModelCapabilities({
      providerID: "volcengine",
      modelID: SUPPORTED_MODELS.KIMI_K2_6,
    })

    // when
    const result = resolveCompatibleModelSettings({
      providerID: "volcengine",
      modelID: SUPPORTED_MODELS.KIMI_K2_6,
      desired: { thinking: { type: "enabled", budgetTokens: 4096 } },
      capabilities,
    })

    // then
    expect(result.thinking).toBeUndefined()
    expect(result.changes[0]?.field).toBe("thinking")
    expect(result.changes[0]?.reason).toBe("unsupported-by-model-metadata")
  })

  test("preserves thinking for kimi-for-coding k2p model ids not matched by generic kimi heuristic", () => {
    for (const modelID of ["k2p6", "k2-p6", "k2.p6"]) {
      // given
      const capabilities = getModelCapabilities({
        providerID: SUPPORTED_PROVIDERS.KIMI_FOR_CODING,
        modelID,
      })

      // when
      const result = resolveCompatibleModelSettings({
        providerID: SUPPORTED_PROVIDERS.KIMI_FOR_CODING,
        modelID,
        desired: { thinking: { type: "enabled", budgetTokens: 4096 } },
        capabilities,
      })

      // then
      expect(result.thinking).toEqual({ type: "enabled", budgetTokens: 4096 })
      expect(result.changes).toEqual([])
    }
  })
  test("resolves variant for k2p models via kimi-thinking heuristic family", () => {
    for (const modelID of [SUPPORTED_MODELS.KIMI_K2P5, "k2p6", "k2-p6", "k2.p6"]) {
      // given
      const capabilities = getModelCapabilities({
        providerID: SUPPORTED_PROVIDERS.KIMI_FOR_CODING,
        modelID,
      })

      // when
      const result = resolveCompatibleModelSettings({
        providerID: SUPPORTED_PROVIDERS.KIMI_FOR_CODING,
        modelID,
        desired: { variant: SUPPORTED_VARIANTS.HIGH },
        capabilities,
      })

      // then
      expect(result.variant).toBe("high")
      expect(result.changes).toEqual([])
    }
  })

  test("detects k2p models as kimi-thinking family with thinking and variants", () => {
    for (const modelID of [SUPPORTED_MODELS.KIMI_K2P5, "k2p6", "k2-p6", "k2.p6"]) {
      // given
      const capabilities = getModelCapabilities({
        providerID: SUPPORTED_PROVIDERS.KIMI_FOR_CODING,
        modelID,
      })

      // then: kimi-thinking heuristic family should detect thinking support
      expect(capabilities.supportsThinking).toBe(true)
      expect(capabilities.family).toBe("kimi-thinking")
      expect(capabilities.variants).toEqual(["low", "medium", "high"])
    }
  })

  test("does not classify kimi-p style IDs as kimi-thinking", () => {
    // given
    const capabilities = getModelCapabilities({
      providerID: SUPPORTED_PROVIDERS.KIMI_FOR_CODING,
      modelID: "kimi-p6",
    })

    // then
    expect(capabilities.family).not.toBe("kimi-thinking")
    expect(capabilities.supportsThinking).not.toBe(true)
  })

  test("clamps maxTokens to the model output limit", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { maxTokens: 200_000 },
      capabilities: { maxOutputTokens: 128_000 },
    })

    expect(result.maxTokens).toBe(128_000)
    expect(result.changes).toEqual([
      {
        field: "maxTokens",
        from: "200000",
        to: "128000",
        reason: "max-output-limit",
      },
    ])
  })

  test("#given capabilities.maxOutputTokens is 0 #then maxTokens preserved unchanged", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { maxTokens: 200_000 },
      capabilities: { maxOutputTokens: 0 },
    })

    expect(result.maxTokens).toBe(200_000)
    expect(result.changes).toEqual([])
  })

  test("#given capabilities.maxOutputTokens is -1 #then maxTokens preserved unchanged", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { maxTokens: 200_000 },
      capabilities: { maxOutputTokens: -1 },
    })

    expect(result.maxTokens).toBe(200_000)
    expect(result.changes).toEqual([])
  })

  test("#given desired.maxTokens is 0 #then maxTokens is dropped", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.OPENAI,
      modelID: SUPPORTED_MODELS.GPT_5_4,
      desired: { maxTokens: 0 },
      capabilities: { maxOutputTokens: 128_000 },
    })

    expect(result.maxTokens).toBeUndefined()
    expect(result.changes).toEqual([])
  })

  // Passthrough: undefined desired values produce no changes
  test("no-op when desired settings are empty", () => {
    const result = resolveCompatibleModelSettings({
      providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
      modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      desired: {},
    })

    expect(result).toEqual({
      variant: undefined,
      reasoningEffort: undefined,
      changes: [],
    })
  })
})
