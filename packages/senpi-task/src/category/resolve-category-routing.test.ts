import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

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

function expectResolved(result: ReturnType<typeof resolveCategory<FakeModel>>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") {
    throw new Error(`Expected resolved category, got ${result.kind}`)
  }
  return result
}

const gpt56CategoryCases = [
  { category: "ultrabrain", modelId: "gpt-5.6-sol" },
  { category: "deep", modelId: "gpt-5.6-terra" },
  { category: "unspecified-low", modelId: "gpt-5.6-luna" },
] as const

describe("resolveCategory routing", () => {
  test("#given quick primary is unavailable and hardcoded fallback is available #when resolved #then delegate-core fallback chain reaches Anthropic Haiku", () => {
    // given
    const models = registry([model("anthropic", "claude-haiku-4-5")])

    // when
    const result = resolveCategory("quick", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("anthropic")
    expect(resolved.spec.modelId).toBe("claude-haiku-4-5")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["anthropic", "github-copilot", "vercel"],
      model: "claude-haiku-4-5",
    })
  })

  test("#given writing's Kimi for Coding default is available #when resolved #then its canonical Kimi K3 id is selected", () => {
    // given
    const models = registry([model("kimi-for-coding", "kimi-k3")])

    // when
    const result = resolveCategory("writing", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("kimi-for-coding")
    expect(resolved.spec.modelId).toBe("kimi-k3")
    expect(resolved.modelSelection.matchedFallback).toBe(false)
  })

  test("#given writing's provider default is unavailable and Kimi K3 is available #when resolved #then the K3 fallback is selected", () => {
    // given
    const models = registry([model("opencode-go", "kimi-k3")])

    // when
    const result = resolveCategory("writing", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("opencode-go")
    expect(resolved.spec.modelId).toBe("kimi-k3")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["opencode-go", "vercel"],
      model: "kimi-k3",
    })
  })

  test("#given Gemini 3.6 Flash is available #when affected category chains resolve #then their stable rungs are selected", () => {
    // given
    const categories = ["quick", "unspecified-low", "writing"] as const

    // when
    for (const category of categories) {
      const result = expectResolved(resolveCategory(category, {}, registry([model("google", "gemini-3.6-flash")])))

      // then
      expect(result.spec.provider).toBe("google")
      expect(result.spec.modelId).toBe("gemini-3.6-flash")
      expect(result.modelSelection.matchedFallback).toBe(true)
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["google", "opencode", "vercel"],
        model: "gemini-3.6-flash",
        requireListedProvider: true,
      })
    }
  })

  test("#given Gemini 3.6 Flash exists only on Copilot #when affected categories resolve #then they do not select the unlisted provider", () => {
    // given
    const categories = ["quick", "unspecified-low", "writing"] as const
    const models = registry([model("github-copilot", "gemini-3.6-flash")])

    // when
    const results = categories.map((category) => resolveCategory(category, {}, models))

    // then
    for (const result of results) {
      expect(result.kind).toBe("model_unavailable")
    }
  })

  test("#given Gemini 3.6 Flash exists only on Copilot and a later rung is available #when affected categories resolve #then they continue to the later rung", () => {
    // given
    const categories = ["quick", "unspecified-low", "writing"] as const
    const models = registry([
      model("github-copilot", "gemini-3.6-flash"),
      model("opencode-go", "minimax-m3"),
    ])

    // when
    const results = categories.map((category) => expectResolved(resolveCategory(category, {}, models)))

    // then
    for (const result of results) {
      expect(result.spec.provider).toBe("opencode-go")
      expect(result.spec.modelId).toBe("minimax-m3")
    }
  })

  test("#given ultrabrain primary is unavailable and hardcoded Google fallback is available #when resolved #then delegate-core fallback chain preserves the high variant", () => {
    // given
    const models = registry([model("google", "gemini-3.1-pro")])

    // when
    const result = resolveCategory("ultrabrain", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("google")
    expect(resolved.spec.modelId).toBe("gemini-3.1-pro")
    expect(resolved.spec.variant).toBe("high")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["google", "github-copilot", "opencode", "vercel"],
      model: "gemini-3.1-pro",
      variant: "high",
    })
  })

  test("#given only transformed Vercel GPT-5.6 models #when deep categories resolve #then each keeps xhigh", () => {
    for (const { category, modelId } of gpt56CategoryCases) {
      const gatewayModelId = `openai/${modelId}`
      const result = expectResolved(resolveCategory(category, {}, registry([model("vercel", gatewayModelId)])))

      expect(result.spec.provider).toBe("vercel")
      expect(result.spec.modelId).toBe(gatewayModelId)
      expect(result.spec.variant).toBe("xhigh")
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["openai", "vercel"],
        model: modelId,
        variant: "xhigh",
      })
    }
  })

  test("#given transformed Vercel and Copilot GPT-5.6 models #when deep categories resolve #then Vercel xhigh wins", () => {
    for (const { category, modelId } of gpt56CategoryCases) {
      const gatewayModelId = `openai/${modelId}`
      const models = registry([
        model("github-copilot", modelId),
        model("vercel", gatewayModelId),
      ])
      const result = expectResolved(resolveCategory(category, {}, models))

      expect(result.spec.provider).toBe("vercel")
      expect(result.spec.modelId).toBe(gatewayModelId)
      expect(result.spec.variant).toBe("xhigh")
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["openai", "vercel"],
        model: modelId,
        variant: "xhigh",
      })
    }
  })

  test("#given only Copilot GPT-5.6 models #when deep categories resolve #then each uses its high rung", () => {
    for (const { category, modelId } of gpt56CategoryCases) {
      const result = expectResolved(resolveCategory(category, {}, registry([model("github-copilot", modelId)])))

      expect(result.spec.provider).toBe("github-copilot")
      expect(result.spec.modelId).toBe(modelId)
      expect(result.spec.variant).toBe("high")
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["github-copilot"],
        model: modelId,
        variant: "high",
      })
    }
  })

  test("#given GPT-5.6 is unavailable #when deep resolves with Copilot GPT-5.5 #then the retired rung is not selected", () => {
    // given / when
    const result = resolveCategory("deep", {}, registry([model("github-copilot", "gpt-5.5")]))

    // then
    expect(result.kind).toBe("model_unavailable")
  })
})
