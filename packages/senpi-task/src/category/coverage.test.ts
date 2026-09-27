/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveCategoryCoverage } from "./coverage"
import type { SenpiModelRegistryPort } from "./types"

type FakeModel = { readonly provider: string; readonly id: string }

function registryOf(provider: string, ids: readonly string[]): SenpiModelRegistryPort<FakeModel> {
  const models = ids.map((id) => ({ provider, id }))
  return {
    getAvailable: () => models,
    find: (modelProvider: string, modelId: string) => models.find((model) => model.provider === modelProvider && model.id === modelId),
  }
}

// The pinned engine's catalog for each provider (senpi 2026.9.26, ModelRuntime.getAvailable()).
const ZAI_MODELS = ["glm-4.7", "glm-5-turbo", "glm-5.2", "glm-5.2-highspeed", "glm-5.3", "glm-5.3-flash", "glm-5.3-highspeed"]
const ANTHROPIC_MODELS = [
  "claude-fable-5", "claude-fable-5-1", "claude-haiku-4-5", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5",
  "claude-sonnet-4-6", "claude-sonnet-5",
]
const GPT_PROVIDERS = ["chatgpt-subscription", "openai", "github-copilot", "opencode"]

describe("resolveCategoryCoverage", () => {
  describe("#given a zai-only registry", () => {
    describe("#when coverage is resolved with no user categories", () => {
      it("#then only unspecified-high is usable and each gap names its unconnected chain providers", () => {
        const coverage = resolveCategoryCoverage({}, registryOf("zai", ZAI_MODELS))

        expect(coverage.usable).toEqual(["unspecified-high"])
        expect(coverage.unusable.map((gap) => gap.name)).toEqual([
          "architect", "artistry", "deep-high", "deep-low", "quick", "ultrabrain", "unspecified-low", "visual-engineering", "writing",
        ])
        const providersOf = (name: string) => coverage.unusable.find((gap) => gap.name === name)?.providers
        expect(providersOf("architect")).toEqual(["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"])
        expect(providersOf("deep-high")).toEqual(GPT_PROVIDERS)
        expect(providersOf("writing")).not.toContain("zai")
      })
    })
  })

  describe("#given an anthropic-only registry", () => {
    describe("#when coverage is resolved with no user categories", () => {
      it("#then the seven claude-served categories are usable and the three GPT lanes name the GPT providers", () => {
        const coverage = resolveCategoryCoverage({}, registryOf("anthropic", ANTHROPIC_MODELS))

        expect(coverage.usable).toEqual([
          "architect", "artistry", "quick", "unspecified-high", "unspecified-low", "visual-engineering", "writing",
        ])
        expect(coverage.unusable).toEqual([
          { name: "deep-high", providers: GPT_PROVIDERS },
          { name: "deep-low", providers: GPT_PROVIDERS },
          { name: "ultrabrain", providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"] },
        ])
      })
    })
  })

  describe("#given a zai-only registry and user categories", () => {
    describe("#when one builtin is pinned and another disabled", () => {
      it("#then the pinned one is usable and the disabled one is neither usable nor a gap", () => {
        const coverage = resolveCategoryCoverage(
          { categories: { quick: { model: "zai/glm-5.3-flash" }, writing: { disable: true } } },
          registryOf("zai", ZAI_MODELS),
        )

        expect(coverage.usable).toEqual(["quick", "unspecified-high"])
        const names = [...coverage.usable, ...coverage.unusable.map((gap) => gap.name)]
        expect(names).not.toContain("writing")
      })
    })
  })

  describe("#given an openai registry that lacks every GPT-6 model", () => {
    describe("#when coverage is resolved", () => {
      it("#then deep-high is unusable and its needed providers leave out the connected openai", () => {
        const coverage = resolveCategoryCoverage({}, registryOf("openai", ["gpt-4o"]))

        expect(coverage.unusable.find((gap) => gap.name === "deep-high")?.providers).toEqual(["chatgpt-subscription", "github-copilot", "opencode"])
      })
    })
  })

  describe("#given a registry whose model list is not an array", () => {
    describe("#when coverage is resolved", () => {
      it("#then it throws instead of reporting every category usable", () => {
        expect(() => resolveCategoryCoverage({}, { getAvailable: () => undefined, find: () => undefined })).toThrow()
      })
    })
  })
})
