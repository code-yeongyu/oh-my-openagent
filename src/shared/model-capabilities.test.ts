import { describe, expect, test } from "bun:test"

import {
  getModelCapabilities,
  type ModelCapabilitiesSnapshot,
} from "./model-capabilities"

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
      "gemini-3.1-pro-preview": {
        id: "gemini-3.1-pro-preview",
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

  test("normalizes thinking suffix aliases before snapshot lookup", () => {
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
  })

  test("maps local gemini aliases to canonical models.dev entries", () => {
    const result = getModelCapabilities({
      providerID: "google",
      modelID: "gemini-3.1-pro-high",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "gemini-3.1-pro-preview",
      family: "gemini",
      supportsThinking: true,
      supportsTemperature: true,
      maxOutputTokens: 65_000,
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
  })

  test("detects prefixed o-series model IDs through the heuristic fallback", () => {
    const result = getModelCapabilities({
      providerID: "azure-openai",
      modelID: "openai/o3-mini",
      bundledSnapshot,
    })

    expect(result).toMatchObject({
      canonicalModelID: "openai/o3-mini",
      family: "openai-reasoning",
      variants: ["low", "medium", "high"],
      reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
    })
  })
})
