/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { applyProviderConfig } from "./provider-config-handler"
import { createModelCacheState } from "../plugin-state"
import { clearVisionCapableModelsCache, readVisionCapableModelsCache } from "../shared/vision-capable-models-cache"

describe("applyProviderConfig", () => {
  test("caches vision-capable models from modalities and capabilities", () => {
    // given
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }
    const config = {
      provider: {
        rundao: {
          models: {
            "public/qwen3.5-397b": {
              modalities: {
                input: ["text", "image"],
              },
            },
            "public/text-only": {
              modalities: {
                input: ["text"],
              },
            },
          },
        },
        google: {
          models: {
            "gemini-3-flash": {
              capabilities: {
                input: {
                  image: true,
                },
              },
            },
          },
        },
      },
    } satisfies Record<string, unknown>

    // when
    applyProviderConfig({ config, modelCacheState })

    // then
    expect(Array.from(visionCapableModelsCache.keys())).toEqual([
      "rundao/public/qwen3.5-397b",
      "google/gemini-3-flash",
    ])
    expect(readVisionCapableModelsCache()).toEqual([
      { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      { providerID: "google", modelID: "gemini-3-flash" },
    ])
  })

  test("clears stale vision-capable models when provider config changes", () => {
    // given
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }
    visionCapableModelsCache.set("stale/old-model", {
      providerID: "stale",
      modelID: "old-model",
    })

    // when
    applyProviderConfig({
      config: { provider: {} },
      modelCacheState,
    })

    // then
    expect(visionCapableModelsCache.size).toBe(0)
    expect(readVisionCapableModelsCache()).toEqual([])
  })
})

clearVisionCapableModelsCache()
