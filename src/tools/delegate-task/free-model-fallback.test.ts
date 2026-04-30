/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { FREE_ONLY_FALLBACK_CHAIN, isKnownFreeModel } from "./free-model-fallback"

describe("FREE_ONLY_FALLBACK_CHAIN", () => {
  // Deprecated by opencode (https://opencode.ai/zen/v1/models, models.dev catalog).
  // If any of these reappear, the chain ships a model that no longer resolves.
  const deprecatedFreeModelIds = ["kimi-k2.5-free", "kimi-k2-free", "kimi-k2-thinking-free"]

  test("does not contain models that opencode has marked deprecated", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      expect(deprecatedFreeModelIds).not.toContain(entry.model)
    }
  })

  test("only contains entries that isKnownFreeModel recognizes", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      expect(isKnownFreeModel(entry.model)).toBe(true)
    }
  })
})
