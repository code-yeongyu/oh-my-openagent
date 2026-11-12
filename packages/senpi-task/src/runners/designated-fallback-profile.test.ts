import { describe, expect, test } from "bun:test"

import { designatedChainOf, designatedFallbackProfile } from "./designated-fallback-profile"

describe("designatedChainOf", () => {
  test("#given a one-model child designated with a thinking suffix #when the host refusal names its chain #then it names the designated model, not the base-model tombstone", () => {
    // given
    const profile = designatedFallbackProfile("anthropic/claude-opus-5-5:high", [])

    // when
    const chain = designatedChainOf(profile)

    // then
    expect(chain).toBe("anthropic/claude-opus-5-5:high")
  })

  test("#given a one-model child designated without a suffix #when the host refusal names its chain #then it names that model", () => {
    // given
    const profile = designatedFallbackProfile("anthropic/claude-opus-5-5", [])

    // when
    const chain = designatedChainOf(profile)

    // then
    expect(chain).toBe("anthropic/claude-opus-5-5")
  })

  test("#given a child with fallback models #when the host refusal names its chain #then it lists the designated models in try order", () => {
    // given
    const profile = designatedFallbackProfile("anthropic/claude-opus-5-5:high", [
      "anthropic/claude-opus-5-5",
      "openai/gpt-6-astra",
    ])

    // when
    const chain = designatedChainOf(profile)

    // then
    expect(chain).toBe("anthropic/claude-opus-5-5:high -> anthropic/claude-opus-5-5 -> openai/gpt-6-astra")
  })

  test("#given a hand-built profile whose chains are all empty #when the host refusal names its chain #then it still prefers the non-tombstone key", () => {
    // given
    const profile = {
      modelFallback: false,
      fallbackChains: { "anthropic/claude-opus-5-5": [], "anthropic/claude-opus-5-5:high": [] },
    }

    // when
    const chain = designatedChainOf(profile)

    // then
    expect(chain).toBe("anthropic/claude-opus-5-5:high")
  })
})
