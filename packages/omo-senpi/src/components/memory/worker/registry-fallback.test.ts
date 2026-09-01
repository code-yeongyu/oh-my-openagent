import { describe, expect, test } from "bun:test"

import { readModelPricing, selectRegistryFallbackModels } from "./registry-fallback"

const priced = (provider: string, id: string, input: number, contextWindow = 200_000) => ({
  provider,
  id,
  cost: { input, output: input * 5, cacheRead: input / 10 },
  contextWindow,
})

describe("selectRegistryFallbackModels", () => {
  describe("#given priced chat models", () => {
    test("#when selected #then cheapest input price wins and at most three candidates are returned", () => {
      // given
      const available = [
        priced("openai", "expensive", 5),
        priced("openai", "cheapest", 0.1),
        priced("openai", "middle", 1),
        priced("openai", "fourth", 2),
      ]

      // when
      const result = selectRegistryFallbackModels(available)

      // then
      expect(result.map((entry) => entry.model)).toEqual([
        "openai/cheapest",
        "openai/middle",
        "openai/fourth",
      ])
    })

    test("#when two models share a price #then the larger context window breaks the tie", () => {
      // given
      const available = [priced("x", "small-ctx", 1, 128_000), priced("x", "big-ctx", 1, 1_000_000)]

      // when / then
      expect(selectRegistryFallbackModels(available)[0]?.model).toBe("x/big-ctx")
    })
  })

  describe("#given models reflection cannot use", () => {
    test("#when the id names a non-chat modality #then it is excluded", () => {
      // given: an embedding model is the cheapest entry by a wide margin
      const available = [priced("openai", "text-embedding-005", 0.001), priced("openai", "chat-model", 1)]

      // when / then
      expect(selectRegistryFallbackModels(available).map((entry) => entry.model)).toEqual(["openai/chat-model"])
    })

    test("#when the context window is below the reflection floor #then it is excluded", () => {
      // given: reflection reads transcript slices, so a tiny window cannot serve it
      const available = [priced("x", "tiny", 0.01, 8_192), priced("x", "roomy", 1, 200_000)]

      // when / then
      expect(selectRegistryFallbackModels(available).map((entry) => entry.model)).toEqual(["x/roomy"])
    })

    test("#when the registry is not an array #then nothing is selected", () => {
      // when / then
      expect(selectRegistryFallbackModels(undefined)).toEqual([])
      expect(selectRegistryFallbackModels({})).toEqual([])
      expect(selectRegistryFallbackModels([{ provider: "x" }, { id: "y" }, null, "junk"])).toEqual([])
    })
  })

  describe("#given a registry without models.dev pricing", () => {
    test("#when selected #then priced models outrank unpriced ones and fast-tier names lead the rest", () => {
      // given
      const available = [
        { provider: "local", id: "heavyweight", contextWindow: 200_000 },
        { provider: "local", id: "swift-flash", contextWindow: 200_000 },
        priced("cloud", "billed", 9),
      ]

      // when
      const result = selectRegistryFallbackModels(available)

      // then
      expect(result.map((entry) => entry.model)).toEqual([
        "cloud/billed",
        "local/swift-flash",
        "local/heavyweight",
      ])
    })
  })
})

describe("readModelPricing", () => {
  test("#given a registry entry #when read #then only numeric cost fields survive", () => {
    // when / then
    expect(readModelPricing({ cost: { input: 1, cacheRead: 0.1 } })).toEqual({ input: 1, cacheRead: 0.1 })
    expect(readModelPricing({ cost: { input: 1 } })).toEqual({ input: 1 })
    expect(readModelPricing({ cost: { cacheRead: 0.1 } })).toBeUndefined()
    expect(readModelPricing({ cost: null })).toBeUndefined()
    expect(readModelPricing({})).toBeUndefined()
    expect(readModelPricing(undefined)).toBeUndefined()
  })
})
