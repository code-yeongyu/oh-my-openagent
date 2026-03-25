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
})
