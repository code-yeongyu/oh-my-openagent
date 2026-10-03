import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { resolveCategory } from "./resolver"

// #9503: a bare model id (no `provider/`) in a category pin means "this model, from whichever connected
// provider serves it" - the meaning a bare id already has in model profiles and in fallback_models.

type FakeModel = { readonly provider: string; readonly id: string }

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function pinned(model: string, extra: Partial<NonNullable<OmoConfig["categories"]>[string]> = {}): OmoConfig {
  return { categories: { quick: { model, ...extra } } }
}

function selected(config: OmoConfig, models: readonly FakeModel[]): string | undefined {
  const resolution = resolveCategory("quick", config, registry(models))
  return resolution.kind === "resolved" ? `${resolution.spec.provider}/${resolution.spec.modelId}` : undefined
}

const OPENCODE_GO_ONLY: readonly FakeModel[] = [
  { provider: "opencode-go", id: "deepseek-v4-flash" },
  { provider: "opencode-go", id: "glm-5.3" },
]

describe("a bare category model pin (#9503)", () => {
  test("#given a bare pin that one connected provider serves #when the category resolves #then that provider's model is used", () => {
    // when
    const resolution = resolveCategory("quick", pinned("deepseek-v4-flash"), registry(OPENCODE_GO_ONLY))

    // then
    expect(resolution.kind).toBe("resolved")
    if (resolution.kind !== "resolved") return
    expect(resolution.spec.provider).toBe("opencode-go")
    expect(resolution.spec.modelId).toBe("deepseek-v4-flash")
  })

  test("#given a bare pin with a reasoning suffix #when the category resolves #then the suffix still applies to the qualified model", () => {
    // when
    const resolution = resolveCategory("quick", pinned("deepseek-v4-flash high"), registry(OPENCODE_GO_ONLY))

    // then
    expect(resolution.kind).toBe("resolved")
    if (resolution.kind !== "resolved") return
    expect(`${resolution.spec.provider}/${resolution.spec.modelId}`).toBe("opencode-go/deepseek-v4-flash")
    expect(resolution.spec.variant).toBe("high")
  })

  test("#given a bare pin two connected providers serve #when the category resolves #then the registry's first exact match wins, as a model profile picks it", () => {
    // given: the registry lists zen before opencode-go; a longer id containing the pin is not an exact match
    const both: readonly FakeModel[] = [
      { provider: "zen", id: "deepseek-v4-flash-preview" },
      { provider: "zen", id: "deepseek-v4-flash" },
      { provider: "opencode-go", id: "deepseek-v4-flash" },
    ]

    // when / then
    expect(selected(pinned("deepseek-v4-flash"), both)).toBe("zen/deepseek-v4-flash")
    expect(selected(pinned("deepseek-v4-flash"), [...both].reverse())).toBe("opencode-go/deepseek-v4-flash")
  })

  test("#given the same bare id as the primary pin or as a fallback entry #when the category resolves #then both pick the same provider", () => {
    // given
    const both: readonly FakeModel[] = [
      { provider: "zen", id: "deepseek-v4-flash" },
      { provider: "opencode-go", id: "deepseek-v4-flash" },
    ]

    // when
    const asPrimary = selected(pinned("deepseek-v4-flash"), both)
    const asFallback = selected(pinned("nowhere/unserved-model", { fallback_models: ["deepseek-v4-flash"] }), both)

    // then
    expect(asPrimary).toBe("zen/deepseek-v4-flash")
    expect(asFallback).toBe(asPrimary)
  })

  test("#given a bare pin no connected provider serves #when the category resolves #then it is unavailable and names the pin as written", () => {
    // when
    const resolution = resolveCategory("quick", pinned("deepseek-v4-flash"), registry([{ provider: "zai", id: "glm-5.3-flash" }]))

    // then
    expect(resolution.kind).toBe("model_unavailable")
    if (resolution.kind !== "model_unavailable") return
    expect(resolution.attemptedModel).toBe("deepseek-v4-flash")
  })

  test("#given a provider-qualified pin #when the category resolves #then it is used as written and never moved to another provider", () => {
    // when / then
    expect(selected(pinned("opencode-go/deepseek-v4-flash"), OPENCODE_GO_ONLY)).toBe("opencode-go/deepseek-v4-flash")
    const elsewhere = resolveCategory("quick", pinned("deepseek/deepseek-v4-flash"), registry(OPENCODE_GO_ONLY))
    expect(elsewhere.kind).toBe("model_unavailable")
  })
})
