/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { resolveMultimodalLookerAgentMetadata } from "./multimodal-agent-metadata"
import { setVisionCapableModelsCache, clearVisionCapableModelsCache } from "../../shared/vision-capable-models-cache"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as modelAvailability from "../../shared/model-availability"

function createPluginInput(agentData: Array<Record<string, unknown>>): PluginInput {
  const client = {} as PluginInput["client"]
  Object.assign(client, {
    app: {
      agents: mock(async () => ({ data: agentData })),
    },
  })

  return {
    client,
    project: {} as PluginInput["project"],
    directory: "/project",
    worktree: "/project",
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

describe("resolveMultimodalLookerAgentMetadata", () => {
  beforeEach(() => {
    clearVisionCapableModelsCache()
  })

  afterEach(() => {
    clearVisionCapableModelsCache()
    ;(modelAvailability.fetchAvailableModels as unknown as { mockRestore?: () => void }).mockRestore?.()
    ;(connectedProvidersCache.readConnectedProvidersCache as unknown as { mockRestore?: () => void }).mockRestore?.()
  })

  test("returns configured multimodal-looker model when it already matches a vision-capable override", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      [
        "rundao/public/qwen3.5-397b",
        { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["rundao/public/qwen3.5-397b"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["rundao"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({
      agentModel: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      agentVariant: undefined,
    })
  })

  test("preserves hardcoded fallback variant when the registered model matches a cache-derived entry", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      [
        "openai/gpt-5.4",
        { providerID: "openai", modelID: "gpt-5.4" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: "medium",
    })
  })

  test("prefers connected vision-capable provider models before the hardcoded fallback chain", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      [
        "rundao/public/qwen3.5-397b",
        { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4", "rundao/public/qwen3.5-397b"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai", "rundao"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        variant: "medium",
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({
      agentModel: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      agentVariant: undefined,
    })
  })

  test("falls back to the hardcoded multimodal chain when no dynamic vision model exists", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      [
        "google/gemini-3-flash",
        { providerID: "google", modelID: "gemini-3-flash" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["google/gemini-3-flash"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["google"])
    const ctx = createPluginInput([])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({
      agentModel: { providerID: "google", modelID: "gemini-3-flash" },
      agentVariant: undefined,
    })
  })

  test("does not return a registered model when no vision-capable model is available", async () => {
    // given
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({})
  })
})
