import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: (): readonly FakeModel[] => models,
    find: (provider: string, modelId: string): FakeModel | undefined =>
      models.find((model) => model.provider === provider && model.id === modelId),
  }
}

// Every rung of the shipped unspecified-low chain, served at once under its first-listed provider.
// With the whole chain available the winner proves chain ORDER, not mere availability: a registry
// serving only one rung can never distinguish a correctly ordered chain from a mis-ordered one.
const FULL_CHAIN_MODELS: readonly FakeModel[] = [
  { provider: "xiaomi", id: "mimo-v2.6-pro" },
  { provider: "xai", id: "grok-4.7" },
  { provider: "chatgpt-subscription", id: "gpt-5.6-terra" },
  { provider: "anthropic", id: "claude-sonnet-5" },
  { provider: "qwen-token-plan", id: "qwen3.8-max-preview" },
  { provider: "deepseek", id: "deepseek-v4-pro" },
  { provider: "xiaomi", id: "mimo-v2.5-pro" },
]

describe("unspecified-low chain order (#8652)", () => {
  test("#given every rung of the chain is served at once #when unspecified-low resolves #then the mimo-v2.6-pro head rung wins", () => {
    // given / when
    const result = resolveCategory("unspecified-low", {}, registry(FULL_CHAIN_MODELS))

    // then
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected unspecified-low to resolve")
    expect(result.spec).toMatchObject({
      provider: "xiaomi",
      modelId: "mimo-v2.6-pro",
      variant: "max",
    })
  })

  test("#given the mimo head is absent but every later rung is served #when unspecified-low resolves #then the grok-4.7 xhigh rung wins", () => {
    // given
    const models = FULL_CHAIN_MODELS.filter((model) => model.id !== "mimo-v2.6-pro")

    // when
    const result = resolveCategory("unspecified-low", {}, registry(models))

    // then
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected unspecified-low to resolve")
    expect(result.spec).toMatchObject({
      provider: "xai",
      modelId: "grok-4.7",
      variant: "xhigh",
    })
  })

  test("#given a registry that only serves the retired grok-4.6 #when unspecified-low resolves #then it is model_unavailable", () => {
    // given / when
    const result = resolveCategory("unspecified-low", {}, registry([{ provider: "xai", id: "grok-4.6" }]))

    // then: grok-4.6 left the chain entirely, so its sole presence must not resolve the category
    expect(result.kind).toBe("model_unavailable")
  })
})
