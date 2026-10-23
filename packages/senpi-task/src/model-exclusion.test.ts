import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { BUILTIN_AGENTS, resolveAgent } from "./agents"
import { resolveAvailableCategoryNames, resolveCategory } from "./category"

type FakeModel = { readonly provider: string; readonly id: string }

function registry(selectors: readonly string[]) {
  const models: readonly FakeModel[] = selectors.map((selector) => {
    const slash = selector.indexOf("/")
    return { provider: selector.slice(0, slash), id: selector.slice(slash + 1) }
  })
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) => models.find((model) => model.provider === provider && model.id === modelId),
  }
}

const CLAUDE_AND_KIMI = registry(["anthropic/claude-fable-5-1", "anthropic/claude-opus-5-5", "kimi-for-coding/k3", "openai/gpt-6.1-sol"])
const NO_FABLE: OmoConfig = { exclude_models: ["claude-fable-*"] }

function resolvedChain(result: ReturnType<typeof resolveCategory>): readonly string[] {
  if (result.kind !== "resolved") throw new Error(`expected a resolved category, got ${result.kind}`)
  return [`${result.spec.provider}/${result.spec.modelId}`, ...(result.spec.fallback_models ?? []).map((model) => model.display)]
}

describe("exclude_models in the spawn resolvers", () => {
  test("#given artistry's Fable head rung excluded #when the category resolves #then the next rung leads and Fable never runs", () => {
    // when
    const result = resolveCategory("artistry", NO_FABLE, CLAUDE_AND_KIMI)

    // then
    expect(resolvedChain(result)).toEqual(["anthropic/claude-opus-5-5", "kimi-for-coding/k3"])
  })

  test("#given a user pin that is itself excluded #when the category resolves #then the pin is treated like a model with no login", () => {
    // given
    const pinOnly: OmoConfig = { exclude_models: ["openai/gpt-6.1-sol"], categories: { artistry: { model: "openai/gpt-6.1-sol" } } }
    const pinWithFallback: OmoConfig = {
      exclude_models: ["openai/gpt-6.1-sol"],
      categories: { artistry: { model: "openai/gpt-6.1-sol", fallback_models: ["anthropic/claude-opus-5-5"] } },
    }

    // when
    const alone = resolveCategory("artistry", pinOnly, CLAUDE_AND_KIMI)
    const walked = resolvedChain(resolveCategory("artistry", pinWithFallback, CLAUDE_AND_KIMI))

    // then
    expect(alone.kind).toBe("model_unavailable")
    expect(walked).toEqual(["anthropic/claude-opus-5-5", "kimi-for-coding/k3"])
  })

  test("#given a category whose every rung is excluded #when listing available categories #then it is gone", () => {
    // given
    const fableOnly = registry(["anthropic/claude-fable-5-1", "anthropic/claude-fable-5"])

    // when
    const names = resolveAvailableCategoryNames(NO_FABLE, fableOnly)

    // then
    expect(names).not.toContain("artistry")
    expect(resolveAvailableCategoryNames({}, fableOnly)).toContain("artistry")
  })

  test("#given an agent whose configured model is excluded #when the agent resolves #then the model is skipped", () => {
    // given
    const agents = { ...BUILTIN_AGENTS, scout: { name: "scout", models: ["anthropic/claude-fable-5-1", "anthropic/claude-opus-5-5"] } }

    // when
    const result = resolveAgent("scout", agents, CLAUDE_AND_KIMI, { omoConfig: NO_FABLE })

    // then
    expect(result.kind === "resolved" ? result.model : result.kind).toBe("anthropic/claude-opus-5-5")
  })
})
