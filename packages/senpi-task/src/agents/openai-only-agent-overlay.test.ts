import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS } from "./builtin"
import { resolveAgent } from "./resolve-agent"
import type { SenpiModelPort, SenpiModelRegistryPort } from "../category/types"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

type FakeRegistry = SenpiModelRegistryPort<FakeModel>

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

function aliasRegistry(
  entries: readonly { readonly provider: string; readonly id: string; readonly upstream: string }[],
): FakeRegistry {
  const models = entries.map((entry) => ({ provider: entry.provider, id: entry.id }))
  const upstreamById = new Map(entries.map((entry) => [`${entry.provider}/${entry.id}`, entry.upstream]))
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
    getUpstreamModelId: (candidate: FakeModel) => upstreamById.get(`${candidate.provider}/${candidate.id}`),
  }
}

function expectResolved(result: ReturnType<typeof resolveAgent>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}`)
  return result
}

describe("resolveAgent openai-only overlay", () => {
  test("#given an openai-only live registry #when explore resolves #then the maintained luna-fast low recommendation applies", () => {
    // given
    const agents = { explore: BUILTIN_AGENTS.explore }
    const registry_ = registry([
      model("openai", "gpt-5.6-sol"),
      model("openai", "gpt-5.6-luna-fast"),
    ])

    // when
    const result = expectResolved(resolveAgent("explore", agents, registry_))

    // then
    expect(result.model).toBe("openai/gpt-5.6-luna-fast")
    expect(result.resolved_model?.variant).toBe("low")
  })

  test("#given later builtin rungs are available #when the explore recommendation resolves #then runtime retries retain those fallbacks", () => {
    // given
    const agents = { explore: BUILTIN_AGENTS.explore }
    const registry_ = registry([
      model("openai", "gpt-5.6-luna-fast"),
      model("openai", "gpt-5.4-nano"),
    ])

    // when
    const result = expectResolved(resolveAgent("explore", agents, registry_))

    // then
    expect(result.requested_model?.display).toBe("openai/gpt-5.6-luna-fast")
    expect(result.fallback_models?.map((fallback) => fallback.display)).toEqual(["openai/gpt-5.4-nano"])
  })

  test("#given only an explicitly mapped provider alias #when explore resolves #then the alias entry satisfies the recommendation", () => {
    // given
    const agents = { explore: BUILTIN_AGENTS.explore }
    const registry_ = aliasRegistry([{ provider: "quotio-openai", id: "luna", upstream: "gpt-5.6-luna-fast" }])

    // when
    const result = expectResolved(resolveAgent("explore", agents, registry_))

    // then
    expect(result.model).toBe("quotio-openai/luna")
    expect(result.resolved_model?.variant).toBe("low")
  })

  test("#given a user-defined explicit model for the agent #when explore resolves against an openai-only registry #then the user model wins over the recommendation", () => {
    // given
    const agents = { explore: { ...BUILTIN_AGENTS.explore, model: "openai/gpt-5.6-sol" } }
    const registry_ = registry([model("openai", "gpt-5.6-sol"), model("openai", "gpt-5.6-luna-fast")])

    // when
    const result = expectResolved(resolveAgent("explore", agents, registry_))

    // then
    expect(result.model).toBe("openai/gpt-5.6-sol")
  })

  test("#given a non-openai inventory #when explore resolves #then no recommendation is synthesized", () => {
    // given
    const agents = { explore: BUILTIN_AGENTS.explore }
    const registry_ = registry([model("google", "gemini-3.1-pro")])

    // when
    const result = resolveAgent("explore", agents, registry_)

    // then
    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an unmapped alias inventory and no upstream surface #when librarian resolves #then the overlay fails closed", () => {
    // given
    const agents = { librarian: BUILTIN_AGENTS.librarian }
    const registry_ = registry([model("quotio-openai", "luna")])

    // when
    const result = resolveAgent("librarian", agents, registry_)

    // then
    expect(result.kind).toBe("model_unavailable")
  })
})
