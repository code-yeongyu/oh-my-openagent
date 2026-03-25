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

  test("downgrades gpt-5 reasoningEffort max to xhigh", () => {
    // given
    const input = {
      providerID: "openai",
      modelID: "gpt-5.4",
      desired: { reasoningEffort: "max" },
    }

    // when
    const result = resolveCompatibleModelSettings(input)

    // then
    expect(result.reasoningEffort).toBe("xhigh")
    expect(result.changes).toEqual([
      {
        field: "reasoningEffort",
        from: "max",
        to: "xhigh",
        reason: "unsupported-by-model-family",
      },
    ])
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

  test("downgrades openai reasoning-family effort xhigh to high", () => {
    // given
    const input = {
      providerID: "openai",
      modelID: "o3-mini",
      desired: { reasoningEffort: "xhigh" },
    }

    // when
    const result = resolveCompatibleModelSettings(input)

    // then
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

  test("drops reasoningEffort for gpt-5 mini models", () => {
    // given
    const input = {
      providerID: "openai",
      modelID: "gpt-5.4-mini",
      desired: { reasoningEffort: "high" },
    }

    // when
    const result = resolveCompatibleModelSettings(input)

    // then
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

  test("treats non-openai o-series models as unknown", () => {
    // given
    const input = {
      providerID: "ollama",
      modelID: "o3",
      desired: { reasoningEffort: "high" },
    }

    // when
    const result = resolveCompatibleModelSettings(input)

    // then
    expect(result.reasoningEffort).toBeUndefined()
    expect(result.changes).toEqual([
      {
        field: "reasoningEffort",
        from: "high",
        to: undefined,
        reason: "unknown-model-family",
      },
    ])
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

  test("downgrades unsupported GPT reasoningEffort to nearest lower level", () => {
    const result = resolveCompatibleModelSettings({
      providerID: "openai",
      modelID: "gpt-4.1",
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
})
