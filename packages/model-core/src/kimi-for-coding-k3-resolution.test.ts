import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"

describe("kimi-for-coding K3 resolution", () => {
  test("sisyphus resolves the real kimi-for-coding k3 catalog id", () => {
    // given: the Kimi subscription catalog from issue #6194
    const availableModels = new Set([
      "kimi-for-coding/k2p7",
      "kimi-for-coding/k3",
      "kimi-for-coding/kimi-for-coding-highspeed",
    ])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "kimi-for-coding/k3",
      source: "provider-fallback",
    })
  })

  test("does not fuzzy-match other kimi-for-coding catalog ids as k3", () => {
    // given: the reporter's catalog without the real k3 id
    const availableModels = new Set([
      "kimi-for-coding/k2p7",
      "kimi-for-coding/kimi-for-coding-highspeed",
    ])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then: neither k2p7 nor the highspeed id satisfies the k3 rung
    expect(result).toEqual({ model: "system/default", source: "system-default" })
  })
})
