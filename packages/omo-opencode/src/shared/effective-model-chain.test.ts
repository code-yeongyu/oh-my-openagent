import { describe, expect, test } from "bun:test"

import {
  modelChainEntryModel,
  resolveEffectiveModelChain,
} from "./effective-model-chain"

describe("resolveEffectiveModelChain", () => {
  describe("#given a canonical models chain only", () => {
    test("#then the first entry is the primary and the rest are fallbacks", () => {
      // given
      const config = {
        models: ["a/one", "b/two", { model: "c/three", reasoning: "low" as const }],
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("a/one")
      expect(chain.fallbackEntries).toEqual(["b/two", { model: "c/three", reasoning: "low" }])
    })
  })

  describe("#given legacy model and fallback_models only", () => {
    test("#then model is primary and normalized fallback_models are the fallbacks", () => {
      // given
      const config = {
        model: "a/one",
        fallback_models: "b/two",
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("a/one")
      expect(chain.fallbackEntries).toEqual(["b/two"])
    })
  })

  describe("#given both a legacy model and a canonical chain with a different head", () => {
    test("#then the legacy model is merged into the chain head instead of being dropped (issue #6868)", () => {
      // given
      const config = {
        model: "opencode-go/deepseek-v4-pro",
        models: ["opencode-go/qwen3.7-plus"],
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("opencode-go/deepseek-v4-pro")
      expect(chain.fallbackEntries).toEqual(["opencode-go/qwen3.7-plus"])
    })
  })

  describe("#given both keys naming the same head model", () => {
    test("#then the head is not duplicated", () => {
      // given
      const config = {
        model: "a/one",
        models: ["a/one", "b/two"],
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("a/one")
      expect(chain.fallbackEntries).toEqual(["b/two"])
    })
  })

  describe("#given a canonical chain plus legacy fallback_models", () => {
    test("#then legacy fallbacks are appended after the chain tail", () => {
      // given - mirrors the combined shape config-migration produces for agents
      const config = {
        models: ["a/one", "b/two"],
        fallback_models: ["c/three"],
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("a/one")
      expect(chain.fallbackEntries).toEqual(["b/two", "c/three"])
    })
  })

  describe("#given an empty models array", () => {
    test("#then the legacy keys stay authoritative", () => {
      // given
      const config = {
        model: "a/one",
        fallback_models: ["b/two"],
        models: [],
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("a/one")
      expect(chain.fallbackEntries).toEqual(["b/two"])
    })
  })

  describe("#given explicit empty fallback_models", () => {
    test("#then suppression is preserved as an empty fallback list", () => {
      // given
      const config = {
        model: "a/one",
        fallback_models: [],
      }

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBe("a/one")
      expect(chain.fallbackEntries).toEqual([])
    })
  })

  describe("#given no model keys at all", () => {
    test("#then neither primary nor fallbacks resolve", () => {
      // given
      const config = {}

      // when
      const chain = resolveEffectiveModelChain(config)

      // then
      expect(chain.primaryModel).toBeUndefined()
      expect(chain.fallbackEntries).toBeUndefined()
      expect(chain.entries).toEqual([])
    })
  })
})

describe("modelChainEntryModel", () => {
  test("#given string and object entries #then both resolve to their model string", () => {
    // given
    const stringEntry = "a/one"
    const objectEntry = { model: "b/two" }

    // when
    const fromString = modelChainEntryModel(stringEntry)
    const fromObject = modelChainEntryModel(objectEntry)

    // then
    expect(fromString).toBe("a/one")
    expect(fromObject).toBe("b/two")
  })
})
