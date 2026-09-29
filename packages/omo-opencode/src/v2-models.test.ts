import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "./config"
import { createModelCacheState } from "./plugin-state"
import {
  collectTrustedVisionModelsV2,
  populateModelCachesV2,
  type V2ProviderInventory,
} from "./v2-models"

function buildInventory(): V2ProviderInventory[] {
  return [
    {
      provider: { id: "anthropic", headers: { "anthropic-beta": "context-1m,other" } },
      models: new Map([
        ["claude-opus", { capabilities: { input: ["text", "image"] }, limit: { context: 200000 } }],
        ["claude-haiku", { capabilities: { input: ["text"] }, limit: { context: 200000 } }],
      ]),
    },
    {
      provider: { id: "openai" },
      models: new Map([
        ["gpt-x", { capabilities: { input: ["text"] }, limit: { context: 128000 } }],
      ]),
    },
  ]
}

describe("v2 model caches", () => {
  it("populates context limits, vision cache, and the anthropic 1M flag", () => {
    // given a provider inventory and empty caches
    const state = createModelCacheState()
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when populated
    populateModelCachesV2(buildInventory(), pluginConfig, state)

    // then caches mirror the v1 provider-config behavior
    expect(state.modelContextLimitsCache.get("anthropic/claude-opus")).toBe(200000)
    expect(state.modelContextLimitsCache.get("openai/gpt-x")).toBe(128000)
    expect(state.visionCapableModelsCache?.has("anthropic/claude-opus")).toBe(true)
    expect(state.visionCapableModelsCache?.has("anthropic/claude-haiku")).toBe(false)
    expect(state.anthropicContext1MEnabled).toBe(true)
  })

  it("adds trusted multimodal-looker models to the vision cache", () => {
    // given a configured multimodal-looker model absent from the inventory
    const state = createModelCacheState()
    const pluginConfig = {
      agents: { "multimodal-looker": { model: "openai/gpt-x" } },
    } as unknown as OhMyOpenCodeConfig

    // when populated
    populateModelCachesV2(buildInventory(), pluginConfig, state)

    // then the trusted model is treated as vision-capable
    expect(collectTrustedVisionModelsV2(pluginConfig)).toEqual(["openai/gpt-x"])
    expect(state.visionCapableModelsCache?.has("openai/gpt-x")).toBe(true)
  })
})
