import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"

const bundledSnapshot = getBundledModelCapabilitiesSnapshot({
  generatedAt: "test",
  sourceUrl: "test",
  models: {},
})

const OPENAI_FAST_ALIASES = [
  { aliasModelID: "gpt-5.6-sol-fast", canonicalModelID: "gpt-5.6-sol" },
  { aliasModelID: "gpt-5.6-terra-fast", canonicalModelID: "gpt-5.6-terra" },
  { aliasModelID: "gpt-5.6-luna-fast", canonicalModelID: "gpt-5.6-luna" },
] as const

describe("OpenAI GPT-5.6 fast capability aliases", () => {
  test("inherits each canonical snapshot entry without changing the requested model ID", () => {
    for (const { aliasModelID, canonicalModelID } of OPENAI_FAST_ALIASES) {
      const canonical = getModelCapabilities({
        providerID: "openai",
        modelID: canonicalModelID,
        bundledSnapshot,
      })
      const alias = getModelCapabilities({
        providerID: "openai",
        modelID: aliasModelID,
        bundledSnapshot,
      })

      expect(alias).toMatchObject({
        requestedModelID: aliasModelID,
        canonicalModelID,
        reasoning: canonical.reasoning,
        supportsTemperature: canonical.supportsTemperature,
        toolCall: canonical.toolCall,
        modalities: canonical.modalities,
        maxOutputTokens: canonical.maxOutputTokens,
      })
      expect(alias.diagnostics).toMatchObject({
        resolutionMode: "alias-backed",
        canonicalization: {
          source: "pattern-alias",
          ruleID: "openai-gpt-5.6-fast-service-tier-alias",
        },
        snapshot: { source: "bundled-snapshot" },
      })
      expect(alias.variants).toEqual(canonical.variants)
      expect(alias.reasoningEfforts).toEqual(canonical.reasoningEfforts)
    }
  })

  test("keeps canonical and unrelated provider behavior unchanged", () => {
    const canonical = getModelCapabilities({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
      bundledSnapshot,
    })
    const unrelatedProvider = getModelCapabilities({
      providerID: "github-copilot",
      modelID: "gpt-5.6-sol-fast",
      bundledSnapshot,
    })
    const unrelatedSuffix = getModelCapabilities({
      providerID: "openai",
      modelID: "gpt-5.6-sol-fast-preview",
      bundledSnapshot,
    })

    expect(canonical).toMatchObject({
      requestedModelID: "gpt-5.6-sol",
      canonicalModelID: "gpt-5.6-sol",
      diagnostics: { resolutionMode: "snapshot-backed" },
    })
    expect(unrelatedProvider).toMatchObject({
      requestedModelID: "gpt-5.6-sol-fast",
      canonicalModelID: "gpt-5.6-sol-fast",
      diagnostics: { resolutionMode: "heuristic-backed" },
    })
    expect(unrelatedSuffix).toMatchObject({
      requestedModelID: "gpt-5.6-sol-fast-preview",
      canonicalModelID: "gpt-5.6-sol-fast-preview",
      diagnostics: { resolutionMode: "heuristic-backed" },
    })
  })

  test("inherits canonical capabilities through a Vercel OpenAI subprovider prefix", () => {
    const alias = getModelCapabilities({
      providerID: "vercel",
      modelID: "openai/gpt-5.6-sol-fast",
      bundledSnapshot,
    })

    expect(alias).toMatchObject({
      requestedModelID: "openai/gpt-5.6-sol-fast",
      canonicalModelID: "gpt-5.6-sol",
      supportsTemperature: false,
      diagnostics: {
        resolutionMode: "alias-backed",
        canonicalization: {
          source: "pattern-alias",
          ruleID: "openai-gpt-5.6-fast-service-tier-alias",
        },
        snapshot: { source: "bundled-snapshot" },
      },
    })
  })
})
