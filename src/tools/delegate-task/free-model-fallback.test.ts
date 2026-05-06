/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  FREE_ONLY_FALLBACK_CHAIN,
  appendFreeModelFallbacks,
  isFreeOnlyProviderConfiguration,
  isKnownFreeModel,
} from "./free-model-fallback"
import freeModelsSnapshot from "../../generated/free-opencode-models.generated.json"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"

const ultrabrainFallbackChain = CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain

describe("free-opencode-models.generated.json", () => {
  test("snapshot contains at least one free model", () => {
    expect(freeModelsSnapshot.models.length).toBeGreaterThan(0)
  })

  test("snapshot models are sorted alphabetically", () => {
    expect(freeModelsSnapshot.models).toEqual([...freeModelsSnapshot.models].sort())
  })
})

describe("FREE_ONLY_FALLBACK_CHAIN", () => {
  test("is derived from the generated snapshot", () => {
    const chainModelIds = FREE_ONLY_FALLBACK_CHAIN.map((entry) => entry.model)
    expect(chainModelIds).toEqual(freeModelsSnapshot.models)
  })

  test("only contains entries that isKnownFreeModel recognizes", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      expect(isKnownFreeModel(entry.model)).toBe(true)
    }
  })

  test("every provider in the chain is recognized as a free-only provider", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      for (const provider of entry.providers) {
        expect(isFreeOnlyProviderConfiguration([provider])).toBe(true)
      }
    }
  })
})

describe("isFreeOnlyProviderConfiguration", () => {
  test("returns true when all providers are in FREE_ONLY_PROVIDER_IDS", () => {
    expect(isFreeOnlyProviderConfiguration(["opencode"])).toBe(true)
  })

  test("returns false when any provider is not in FREE_ONLY_PROVIDER_IDS", () => {
    expect(isFreeOnlyProviderConfiguration(["opencode", "anthropic"])).toBe(false)
  })

  test("returns false for null", () => {
    expect(isFreeOnlyProviderConfiguration(null)).toBe(false)
  })

  test("returns false for empty array", () => {
    expect(isFreeOnlyProviderConfiguration([])).toBe(false)
  })
})

describe("appendFreeModelFallbacks", () => {
  test("returns FREE_ONLY_FALLBACK_CHAIN when original chain is undefined", () => {
    const result = appendFreeModelFallbacks(undefined)
    expect(result).toEqual(FREE_ONLY_FALLBACK_CHAIN)
  })

  test("returns FREE_ONLY_FALLBACK_CHAIN when original chain is empty", () => {
    const result = appendFreeModelFallbacks([])
    expect(result).toEqual(FREE_ONLY_FALLBACK_CHAIN)
  })

  test("preserves original chain order then appends free models in FREE_ONLY_FALLBACK_CHAIN order", () => {
    const result = appendFreeModelFallbacks(ultrabrainFallbackChain)
    expect(result.length).toBeGreaterThan(ultrabrainFallbackChain.length)
    expect(result.slice(0, ultrabrainFallbackChain.length)).toEqual(ultrabrainFallbackChain)

    const appended = result.slice(ultrabrainFallbackChain.length)
    const expectedAppended = FREE_ONLY_FALLBACK_CHAIN.filter(
      (entry) => !ultrabrainFallbackChain.some((e) => e.model === entry.model),
    )
    expect(appended).toEqual(expectedAppended)
  })

  test("does not duplicate free models already present in the chain", () => {
    const chainWithFreeEntry = [
      ...ultrabrainFallbackChain,
      FREE_ONLY_FALLBACK_CHAIN[0],
    ]
    const result = appendFreeModelFallbacks(chainWithFreeEntry)

    const modelCounts = new Map<string, number>()
    for (const entry of result) {
      modelCounts.set(entry.model, (modelCounts.get(entry.model) ?? 0) + 1)
    }
    for (const [model, count] of modelCounts) {
      expect(count).toBe(1)
    }
  })
})
