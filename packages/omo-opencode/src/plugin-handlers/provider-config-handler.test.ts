/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { applyProviderConfig } from "./provider-config-handler"
import { createModelCacheState } from "../plugin-state"
import { clearVisionCapableModelsCache, readVisionCapableModelsCache } from "../shared/vision-capable-models-cache"

describe("applyProviderConfig", () => {
  test("clears stale model context limits when provider config changes", () => {
    // given
    const modelCacheState = createModelCacheState()
    applyProviderConfig({
      config: {
        provider: {
          opencode: {
            models: {
              "kimi-k2.5-free": {
                limit: { context: 262144 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    // when
    applyProviderConfig({
      config: {
        provider: {
          google: {
            models: {
              "gemini-2.5-pro": {
                limit: { context: 1048576 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    // then
    expect(Array.from(modelCacheState.modelContextLimitsCache.entries())).toEqual([
      ["google/gemini-2.5-pro", 1048576],
    ])
  })

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

  test("trusts user-configured multimodal-looker model even when provider config omits modalities", () => {
    // given - user configures glm-5.1 as multimodal-looker but provider model entry has no modalities/capabilities
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }
    const config = {
      provider: {
        "zhipuai-coding-plan": {
          models: {
            "glm-5.1": {
              limit: { context: 200000 },
            },
          },
        },
      },
    } satisfies Record<string, unknown>

    // when
    applyProviderConfig({
      config,
      modelCacheState,
      trustedVisionCapableModels: ["zhipuai-coding-plan/glm-5.1"],
    })

    // then - trusted model is in cache even though provider config did not declare image support
    expect(Array.from(visionCapableModelsCache.keys())).toEqual([
      "zhipuai-coding-plan/glm-5.1",
    ])
    expect(readVisionCapableModelsCache()).toEqual([
      { providerID: "zhipuai-coding-plan", modelID: "glm-5.1" },
    ])
  })

  test("does not duplicate a trusted model already discovered via provider modalities", () => {
    // given
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }
    const config = {
      provider: {
        google: {
          models: {
            "gemini-3-flash": {
              modalities: { input: ["text", "image"] },
            },
          },
        },
      },
    } satisfies Record<string, unknown>

    // when
    applyProviderConfig({
      config,
      modelCacheState,
      trustedVisionCapableModels: ["google/gemini-3-flash"],
    })

    // then
    expect(Array.from(visionCapableModelsCache.keys())).toEqual([
      "google/gemini-3-flash",
    ])
  })

  test("ignores malformed trusted vision-capable model strings", () => {
    // given - entries missing provider or model are skipped silently
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }

    // when
    applyProviderConfig({
      config: { provider: {} },
      modelCacheState,
      trustedVisionCapableModels: ["no-slash", "/missing-provider", "provider-only/"],
    })

    // then
    expect(visionCapableModelsCache.size).toBe(0)
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
