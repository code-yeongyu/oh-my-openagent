import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS } from "../agents/builtin"
import { resolveAgent } from "../agents/resolve-agent"
import { DEFAULT_CATEGORIES } from "./builtins"
import { resolveCategoryCoverage } from "./coverage"
import { resolveAvailableCategoryNames, resolveCategory } from "./resolver"

// #9146: a builtin chain rung resolves only on the providers it lists. A gateway that re-publishes
// the same models (OpenRouter, opengateway, ...) is never picked for a builtin category or agent;
// only an explicit user pin reaches it. Ids below are spelled exactly as each gateway's catalog does.

type FakeModel = { readonly provider: string; readonly id: string }

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function gateway(provider: string, ids: readonly string[]): readonly FakeModel[] {
  return ids.map((id) => ({ provider, id }))
}

const OPENROUTER_ONLY = gateway("openrouter", [
  "anthropic/claude-fable-5",
  "anthropic/claude-fable-5.1",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-6-astra",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-6-luna",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.3",
  "~deepseek/deepseek-flash-latest",
  "deepseek/deepseek-v4-pro",
  "xiaomi/mimo-v2.6-pro",
  "xiaomi/mimo-v2.5-pro",
  "x-ai/grok-4.7",
])

// opengateway spells the Anthropic ids with dashes, so `claude-fable-5-1` matches verbatim.
const OPENGATEWAY_ONLY = gateway("opengateway", [
  "anthropic/claude-fable-5-1",
  "anthropic/claude-opus-5-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-6-astra",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.3",
  "deepseek/deepseek-flash",
  "deepseek/deepseek-v4-pro",
])

const GATEWAY_REGISTRIES = [
  { name: "OpenRouter", models: OPENROUTER_ONLY },
  { name: "opengateway", models: OPENGATEWAY_ONLY },
] as const

const BUILTIN_CATEGORY_NAMES = Object.keys(DEFAULT_CATEGORIES).sort()
const BUILTIN_AGENT_NAMES = Object.keys(BUILTIN_AGENTS).sort()

describe("builtin chains resolve only on their listed providers (#9146)", () => {
  for (const { name, models } of GATEWAY_REGISTRIES) {
    describe(`#given only ${name} is connected`, () => {
      for (const category of BUILTIN_CATEGORY_NAMES) {
        test(`#when ${category} resolves #then no ${name} model is selected`, () => {
          const result = resolveCategory(category, {}, registry(models))

          expect(result.kind).toBe("model_unavailable")
          expect(result.availableCategories).not.toContain(category)
        })
      }

      test("#when the task tool lists categories #then every builtin is hidden", () => {
        expect(resolveAvailableCategoryNames({}, registry(models))).toEqual([])
      })

      for (const agent of BUILTIN_AGENT_NAMES) {
        test(`#when the ${agent} agent resolves #then no ${name} model is selected`, () => {
          const result = resolveAgent(agent, BUILTIN_AGENTS, registry(models))

          expect(result.kind).toBe("model_unavailable")
        })
      }
    })
  }

  describe("#given the reported plan-consultant spawn: no override, OpenRouter the only lane serving Opus 5.5", () => {
    test("#when the builtin agent resolves #then it is never source agent on openrouter/anthropic/claude-opus-5.5 at max", () => {
      const result = resolveAgent("plan-consultant", BUILTIN_AGENTS, registry(OPENROUTER_ONLY))

      expect(result.kind).toBe("model_unavailable")
      expect("resolved_model" in result).toBe(false)
    })

    test("#when the listed Anthropic lane is also connected #then the same agent resolution lands there instead", () => {
      const result = resolveAgent(
        "plan-consultant",
        BUILTIN_AGENTS,
        registry([...OPENROUTER_ONLY, { provider: "anthropic", id: "claude-opus-5-5" }]),
      )

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.resolved_model).toEqual({
        source: "agent",
        provider: "anthropic",
        model_id: "claude-opus-5-5",
        display: "anthropic/claude-opus-5-5",
        variant: "max",
        reasoning: "max",
      })
    })
  })

  describe("#given a builtin hidden because only OpenRouter serves it", () => {
    test("#when it resolves #then the result names the exact gateway model to opt into", () => {
      const result = resolveCategory("writing", {}, registry(OPENROUTER_ONLY))

      expect(result).toMatchObject({
        kind: "model_unavailable",
        unlisted_provider_model: "openrouter/anthropic/claude-opus-5.5",
      })
    })

    test("#when doctor asks for coverage #then the gap carries the same opt-in model", () => {
      const coverage = resolveCategoryCoverage({}, registry(OPENROUTER_ONLY))

      expect(coverage.usable).toEqual([])
      expect(coverage.unusable.find((gap) => gap.name === "writing")?.unlistedProviderModel)
        .toBe("openrouter/anthropic/claude-opus-5.5")
    })

    test("#when the user pins that model #then the category resolves on it", () => {
      const config = { categories: { writing: { model: "openrouter/anthropic/claude-opus-5.5" } } }
      const result = resolveCategory("writing", config, registry(OPENROUTER_ONLY))

      expect(result.kind).toBe("resolved")
      expect(resolveCategoryCoverage(config, registry(OPENROUTER_ONLY)).usable).toEqual(["writing"])
    })
  })

  describe("#given the user pinned an OpenRouter model explicitly", () => {
    test("#when a category names it in model #then that pin is honored", () => {
      const result = resolveCategory(
        "visual-engineering",
        { categories: { "visual-engineering": { model: "openrouter/anthropic/claude-opus-5.5" } } },
        registry(OPENROUTER_ONLY),
      )

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("openrouter")
      expect(result.spec.modelId).toBe("anthropic/claude-opus-5.5")
    })

    test("#when a category names it in models[] #then that pin is honored", () => {
      const result = resolveCategory(
        "ultrabrain",
        { categories: { ultrabrain: { models: ["openrouter/openai/gpt-6-astra"] } } },
        registry(OPENROUTER_ONLY),
      )

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("openrouter")
      expect(result.spec.modelId).toBe("openai/gpt-6-astra")
      expect(resolveAvailableCategoryNames(
        { categories: { ultrabrain: { models: ["openrouter/openai/gpt-6-astra"] } } },
        registry(OPENROUTER_ONLY),
      )).toEqual(["ultrabrain"])
    })

    test("#when an agent names it as its model #then that pin is honored", () => {
      const pinned = {
        ...BUILTIN_AGENTS,
        "plan-consultant": { ...BUILTIN_AGENTS["plan-consultant"], model: "openrouter/anthropic/claude-opus-5.5" },
      }

      const result = resolveAgent("plan-consultant", pinned, registry(OPENROUTER_ONLY))

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.model).toBe("openrouter/anthropic/claude-opus-5.5")
    })
  })

  describe("#given OpenRouter and a listed provider are both connected", () => {
    test("#when unspecified-high resolves #then the listed Anthropic lane wins", () => {
      const result = resolveCategory(
        "unspecified-high",
        {},
        registry([...OPENROUTER_ONLY, { provider: "anthropic", id: "claude-opus-5-5" }]),
      )

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("anthropic")
      expect(result.spec.fallback_models?.map((entry) => entry.provider) ?? []).not.toContain("openrouter")
    })

    test("#when ultrabrain resolves #then a later listed rung beats the gateway's copy of an earlier rung", () => {
      const result = resolveCategory(
        "ultrabrain",
        {},
        registry([...OPENROUTER_ONLY, { provider: "github-copilot", id: "gpt-5.6-sol" }]),
      )

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("github-copilot")
      expect(result.spec.modelId).toBe("gpt-5.6-sol")
    })

    test("#when plan-consultant resolves #then the listed lane wins over the gateway", () => {
      const result = resolveAgent(
        "plan-consultant",
        BUILTIN_AGENTS,
        registry([...OPENROUTER_ONLY, { provider: "moonshotai", id: "kimi-k3" }]),
      )

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.model).toBe("moonshotai/kimi-k3")
    })
  })
})
