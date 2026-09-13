import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS } from "../agents/builtin"
import { resolveAgent } from "../agents/resolve-agent"
import { resolveCategory } from "./index"

// Regression coverage for code-yeongyu/oh-my-openagent#8051: senpi's Claude subscription lane
// (`claude-sdk-oauth`, Claude Pro/Max) serves the same model ids as `anthropic`. A machine that is
// logged in there AND holds an OpenCode Zen key sees both providers in `getAvailable()`, and every
// builtin Claude rung must pick the subscription lane, not the metered `opencode` one.

type FakeModel = {
  readonly provider: string
  readonly id: string
}

type FakeRegistry = {
  readonly getAvailable: () => readonly FakeModel[]
  readonly find: (provider: string, modelId: string) => FakeModel | undefined
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]): FakeRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function expectResolvedCategory(
  result: ReturnType<typeof resolveCategory<FakeModel>>,
): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved category, got ${result.kind}`)
  return result
}

function expectResolvedAgent(result: ReturnType<typeof resolveAgent>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}`)
  return result
}

const CLAUDE_IDS = ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-4-6"] as const

// The metered lane is listed FIRST so registry order cannot be what picks the subscription lane.
function subscriptionAndMeteredRegistry(): FakeRegistry {
  return registry(CLAUDE_IDS.flatMap((id) => [model("opencode", id), model("claude-sdk-oauth", id)]))
}

describe("builtin Claude rungs under the senpi harness", () => {
  test("#given claude-sdk-oauth and opencode both serve Fable 5.1 #when architect resolves #then the subscription lane wins", () => {
    // when
    const resolved = expectResolvedCategory(resolveCategory("architect", {}, subscriptionAndMeteredRegistry()))

    // then
    expect(resolved.spec.provider).toBe("claude-sdk-oauth")
    expect(resolved.spec.modelId).toBe("claude-fable-5-1")
    expect(resolved.spec.variant).toBe("max")
    expect(resolved.modelSelection.fallbackEntry?.providers[0]).toBe("claude-sdk-oauth")
  })

  test("#given claude-sdk-oauth and opencode both serve Opus 5 #when unspecified-high resolves #then the subscription lane wins", () => {
    // when
    const resolved = expectResolvedCategory(resolveCategory("unspecified-high", {}, subscriptionAndMeteredRegistry()))

    // then
    expect(resolved.spec.provider).toBe("claude-sdk-oauth")
    expect(resolved.spec.modelId).toBe("claude-opus-5")
    expect(resolved.spec.variant).toBe("xhigh")
  })

  test("#given claude-sdk-oauth and opencode both serve Sonnet 4.6 #when plan-consultant resolves #then the subscription lane wins", () => {
    // when
    const resolved = expectResolvedAgent(resolveAgent("plan-consultant", BUILTIN_AGENTS, subscriptionAndMeteredRegistry()))

    // then
    expect(resolved.model).toBe("claude-sdk-oauth/claude-sonnet-4-6")
    expect(resolved.resolved_model).toMatchObject({ provider: "claude-sdk-oauth", model_id: "claude-sonnet-4-6" })
  })

  test("#given claude-sdk-oauth is absent #when Claude rungs resolve #then selection is identical to the pre-lane table", () => {
    // given: the registry shape of a machine without a Claude subscription login
    const apiKeyRegistry = registry([
      model("opencode", "claude-fable-5-1"),
      model("github-copilot", "claude-fable-5-1"),
      model("anthropic", "claude-fable-5-1"),
      model("opencode", "claude-sonnet-4-6"),
      model("anthropic", "claude-sonnet-4-6"),
    ])
    const meteredOnlyRegistry = registry([model("opencode", "claude-fable-5-1"), model("opencode", "claude-opus-5")])

    // when
    const architect = expectResolvedCategory(resolveCategory("architect", {}, apiKeyRegistry))
    const meteredArchitect = expectResolvedCategory(resolveCategory("architect", {}, meteredOnlyRegistry))
    const meteredHigh = expectResolvedCategory(resolveCategory("unspecified-high", {}, meteredOnlyRegistry))
    const planConsultant = expectResolvedAgent(resolveAgent("plan-consultant", BUILTIN_AGENTS, apiKeyRegistry))

    // then: the provider-pinned category default still wins outright, opencode is still the last
    // resort on a metered-only machine, and the requested-model record is untouched
    expect([architect.spec.provider, architect.spec.modelId, architect.spec.variant]).toEqual([
      "anthropic", "claude-fable-5-1", "max",
    ])
    expect(architect.spec.requested_model?.display).toBe("anthropic/claude-fable-5-1")
    expect(architect.modelSelection).toMatchObject({ selectedModel: "anthropic/claude-fable-5-1", matchedFallback: false })
    expect([meteredArchitect.spec.provider, meteredArchitect.spec.modelId, meteredArchitect.spec.variant]).toEqual([
      "opencode", "claude-fable-5-1", "max",
    ])
    expect(meteredArchitect.modelSelection).toMatchObject({
      selectedModel: "opencode/claude-fable-5-1",
      matchedFallback: true,
      fallbackEntry: { model: "claude-fable-5-1", variant: "max" },
    })
    expect([meteredHigh.spec.provider, meteredHigh.spec.modelId, meteredHigh.spec.variant]).toEqual([
      "opencode", "claude-opus-5", "xhigh",
    ])
    expect(meteredHigh.spec.requested_model?.display).toBe("openai/gpt-6-astra")
    expect(planConsultant.model).toBe("anthropic/claude-sonnet-4-6")
    expect(planConsultant.resolved_model?.display).toBe("anthropic/claude-sonnet-4-6")
    expect(planConsultant.fallback_models).toBeUndefined()
  })
})
