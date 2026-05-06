/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { FREE_ONLY_FALLBACK_CHAIN } from "./free-model-fallback"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"

const ultrabrainFallbackChain = CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain

function qualifiedModel(entry: { providers: string[]; model: string }, provider = "opencode"): string {
  return `${provider}/${entry.model}`
}

describe("resolveModelForDelegateTask free-only fallback", () => {
  beforeEach(() => {
    mock.restore()
    spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
    spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["opencode"])
  })

  test("resolves to a free model when availableModels contains only free models", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(ultrabrainFallbackChain[0]),
      fallbackChain: ultrabrainFallbackChain,
      availableModels: new Set([
        qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[0]),
        qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[1]),
      ]),
    })

    expect(result).toEqual({
      model: qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[0]),
      fallbackEntry: FREE_ONLY_FALLBACK_CHAIN[0],
      matchedFallback: true,
    })
  })

  test("resolves to a free model on cold cache when only free providers are connected", () => {
    const result = resolveModelForDelegateTask({
      fallbackChain: ultrabrainFallbackChain,
      availableModels: new Set(),
    })

    expect(result).toEqual({
      model: qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[0]),
      fallbackEntry: FREE_ONLY_FALLBACK_CHAIN[0],
      matchedFallback: true,
    })
  })

  test("keeps an explicit user-configured category model even in free-only mode", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(ultrabrainFallbackChain[0]),
      isUserConfiguredCategoryModel: true,
      availableModels: new Set([
        qualifiedModel(ultrabrainFallbackChain[0]),
        qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[0]),
      ]),
    })

    expect(result).toEqual({ model: qualifiedModel(ultrabrainFallbackChain[0]) })
  })

  test("does not downgrade a paid Zen subscriber whose availableModels contains paid models", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(ultrabrainFallbackChain[0]),
      fallbackChain: ultrabrainFallbackChain,
      availableModels: new Set([
        qualifiedModel(ultrabrainFallbackChain[0]),
        qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[0]),
        qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[1]),
      ]),
    })

    expect(result).toEqual({ model: qualifiedModel(ultrabrainFallbackChain[0]) })
  })

  test("does not rewrite a paid Zen subscriber's fallback chain to the free-only chain", () => {
    const result = resolveModelForDelegateTask({
      fallbackChain: ultrabrainFallbackChain,
      availableModels: new Set([
        qualifiedModel(ultrabrainFallbackChain[0]),
        qualifiedModel(FREE_ONLY_FALLBACK_CHAIN[0]),
      ]),
    })

    expect(result).toEqual({
      model: qualifiedModel(ultrabrainFallbackChain[0]),
      variant: ultrabrainFallbackChain[0].variant,
      fallbackEntry: ultrabrainFallbackChain[0],
      matchedFallback: true,
    })
  })

  test("does not silently drop a paid category default when connectedProviders is opencode-only", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(ultrabrainFallbackChain[0]),
      availableModels: new Set([qualifiedModel(ultrabrainFallbackChain[0])]),
    })

    expect(result).toEqual({ model: qualifiedModel(ultrabrainFallbackChain[0]) })
  })
})
