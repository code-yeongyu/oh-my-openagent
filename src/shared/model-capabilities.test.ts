import { describe, expect, test } from "bun:test"

import {
  getModelCapabilities,
  getBundledModelCapabilitiesSnapshot,
  type ModelCapabilitiesSnapshot,
} from "./model-capabilities"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("getModelCapabilities", () => {
  const bundledSnapshot: ModelCapabilitiesSnapshot = {
    generatedAt: "2026-03-25T00:00:00.000Z",
    sourceUrl: "https://models.dev/api.json",
    models: {
      "claude-opus-4-6": {
        id: "claude-opus-4-6",
        family: "claude-opus",
        reasoning: true,
        temperature: true,
        modalities: {
          input: ["text", "image", "pdf"],
          output: ["text"],
        },
        limit: {
          context: 1_000_000,
          output: 128_000,
        },
        toolCall: true,
      },
      "gemini-3.1-pro": {
        id: "gemini-3.1-pro",
        family: "gemini",
        reasoning: true,
        temperature: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 1_000_000,
          output: 65_000,
        },
      },
      "gpt-5.4": {
        id: "gpt-5.4",
        family: "gpt",
        reasoning: true,
        temperature: false,
        modalities: {
          input: ["text", "image", "pdf"],
          output: ["text"],
        },
        limit: {
          context: 1_050_000,
          output: 128_000,
        },
      },
    },
  }

  test("uses runtime metadata before snapshot data", () => {
    const result = getModelCapabilities({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      runtimeModel: {
        variants: {
          low: {},
          medium: {},
          high: {},
        },
      },
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "claude-opus-4-6",
      family: "claude-opus",
      variants: ["low", "medium", "high"],
      supportsThinking: true,
      supportsTemperature: true,
      maxOutputTokens: 128_000,
      toolCall: true,
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "snapshot-backed",
      canonicalization: { source: "canonical" },
      snapshot: { source: "bundled-snapshot" },
      variants: { source: "runtime" },
    })
  })

  test("reads structured runtime capabilities from the SDK v2 shape", () => {
    const result = getModelCapabilities({
      providerID: "openai",
      modelID: "gpt-5.4",
      runtimeModel: {
        capabilities: {
          reasoning: true,
          temperature: false,
          toolcall: true,
          input: {
            text: true,
            image: true,
          },
          output: {
            text: true,
          },
        },
      },
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "gpt-5.4",
      reasoning: true,
      supportsThinking: true,
      supportsTemperature: false,
      toolCall: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "snapshot-backed",
      reasoning: { source: "runtime" },
      supportsThinking: { source: "runtime" },
      toolCall: { source: "runtime" },
    })
  })

  test("respects root-level thinking flags when providers do not nest them under capabilities", () => {
    const result = getModelCapabilities({
      providerID: "custom-proxy",
      modelID: "gpt-5.4",
      runtimeModel: {
        supportsThinking: true,
      },
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "gpt-5.4",
      supportsThinking: true,
    })
    expect(result.diagnostics).toMatchObject({
      supportsThinking: { source: "runtime" },
    })
  })

  test("accepts runtime variant arrays without corrupting them into numeric keys", () => {
    const result = getModelCapabilities({
      providerID: "openai",
      modelID: "gpt-5.4",
      runtimeModel: {
        variants: ["low", "medium", "high", "xhigh"],
      },
      bundledSnapshot,
    })

    expect(result.variants).toEqual(["low", "medium", "high", "xhigh"])
  })

  test("normalizes the legacy Claude Opus thinking alias before snapshot lookup", () => {
    const result = getModelCapabilities({
      providerID: "anthropic",
      modelID: "claude-opus-4-6-thinking",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "claude-opus-4-6",
      family: "claude-opus",
      supportsThinking: true,
      supportsTemperature: true,
      maxOutputTokens: 128_000,
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "alias-backed",
      canonicalization: {
        source: "pattern-alias",
        ruleID: "claude-thinking-legacy-alias",
      },
      snapshot: { source: "bundled-snapshot" },
    })
  })

  test("maps local gemini aliases to canonical models.dev entries", () => {
    const result = getModelCapabilities({
      providerID: "google",
      modelID: "gemini-3.1-pro-high",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "gemini-3.1-pro",
      family: "gemini",
      supportsThinking: true,
      supportsTemperature: true,
      maxOutputTokens: 65_000,
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "alias-backed",
      canonicalization: {
        source: "pattern-alias",
        ruleID: "gemini-3.1-pro-tier-alias",
      },
      snapshot: { source: "bundled-snapshot" },
    })
  })

  test("canonicalizes provider-prefixed gemini aliases without changing the transport-facing request", () => {
    const result = getModelCapabilities({
      providerID: "google",
      modelID: "google/gemini-3.1-pro-high",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      requestedModelID: "google/gemini-3.1-pro-high",
      canonicalModelID: "gemini-3.1-pro",
      family: "gemini",
      supportsThinking: true,
      supportsTemperature: true,
      maxOutputTokens: 65_000,
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "alias-backed",
      canonicalization: {
        source: "pattern-alias",
        ruleID: "gemini-3.1-pro-tier-alias",
      },
      snapshot: { source: "bundled-snapshot" },
    })
  })

  test("canonicalizes provider-prefixed Claude thinking aliases to bare snapshot IDs", () => {
    const result = getModelCapabilities({
      providerID: "anthropic",
      modelID: "anthropic/claude-opus-4-6-thinking",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      requestedModelID: "anthropic/claude-opus-4-6-thinking",
      canonicalModelID: "claude-opus-4-6",
      family: "claude-opus",
      supportsThinking: true,
      supportsTemperature: true,
      maxOutputTokens: 128_000,
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "alias-backed",
      canonicalization: {
        source: "pattern-alias",
        ruleID: "claude-thinking-legacy-alias",
      },
      snapshot: { source: "bundled-snapshot" },
    })
  })

  test("prefers runtime models.dev cache over bundled snapshot", () => {
    const runtimeSnapshot: ModelCapabilitiesSnapshot = {
      ...bundledSnapshot,
      models: {
        ...bundledSnapshot.models,
        "gpt-5.4": {
          ...bundledSnapshot.models["gpt-5.4"],
          limit: {
            context: 1_050_000,
            output: 64_000,
          },
        },
      },
    }

    const result = getModelCapabilities({
      providerID: "openai",
      modelID: "gpt-5.4",
      bundledSnapshot,
      runtimeSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "gpt-5.4",
      maxOutputTokens: 64_000,
      supportsTemperature: false,
    })
    expect(result.diagnostics).toMatchObject({
      snapshot: { source: "runtime-snapshot" },
      maxOutputTokens: { source: "runtime-snapshot" },
      supportsTemperature: { source: "runtime-snapshot" },
    })
  })

  test("falls back to heuristic family rules when no snapshot entry exists", () => {
    const result = getModelCapabilities({
      providerID: "openai",
      modelID: "o3-mini",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "o3-mini",
      family: "openai-reasoning",
      variants: ["low", "medium", "high"],
      reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "heuristic-backed",
      snapshot: { source: "none" },
      family: { source: "heuristic" },
      reasoningEfforts: { source: "heuristic" },
    })
  })

  test("detects prefixed o-series model IDs through the heuristic fallback", () => {
    const result = getModelCapabilities({
      providerID: "azure-openai",
      modelID: "openai/o3-mini",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      requestedModelID: "openai/o3-mini",
      canonicalModelID: "o3-mini",
      family: "openai-reasoning",
      variants: ["low", "medium", "high"],
      reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "heuristic-backed",
      snapshot: { source: "none" },
      family: { source: "heuristic" },
    })
  })

  test("keeps every built-in OmO requirement model snapshot-backed", () => {
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot()
    const requirementModels = new Set<string>()

    for (const requirement of Object.values(AGENT_MODEL_REQUIREMENTS)) {
      for (const entry of requirement.fallbackChain) requirementModels.add(entry.model)
    }

    for (const requirement of Object.values(CATEGORY_MODEL_REQUIREMENTS)) {
      for (const entry of requirement.fallbackChain) requirementModels.add(entry.model)
    }

    for (const modelID of requirementModels) {
      const result = getModelCapabilities({
        providerID: "test-provider",
        modelID,
        bundledSnapshot,
      })

      expect(result.diagnostics.resolutionMode).toBe("snapshot-backed")
      expect(result.diagnostics.snapshot.source).toBe("bundled-snapshot")
    }
  })
})
