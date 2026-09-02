import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"
import type { SenpiModelRegistryPort, SenpiModelPort } from "./types"

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

// A provider alias whose models carry senpi's explicit `upstreamModelId` mapping.
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

const OPENAI_ONLY_INVENTORY = [
  model("openai", "gpt-5.6-sol"),
  model("openai", "gpt-5.6-terra"),
  model("openai", "gpt-5.6-luna-fast"),
]

function expectResolved(
  result: ReturnType<typeof resolveCategory<FakeModel>>,
): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved category, got ${result.kind}`)
  return result
}

describe("resolveCategory openai-only overlay", () => {
  test("#given an openai-only live registry and no user entries #when artistry resolves #then the maintained sol xhigh recommendation applies", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)

    // when
    const result = resolveCategory("artistry", {}, registry_)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("openai")
    expect(resolved.spec.modelId).toBe("gpt-5.6-sol")
    expect(resolved.spec.variant).toBe("xhigh")
    expect(resolved.availableCategories).toContain("artistry")
  })

  test("#given an openai-only live registry #when writing resolves #then the maintained sol medium recommendation applies", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)

    // when
    const result = resolveCategory("writing", {}, registry_)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("openai")
    expect(resolved.spec.modelId).toBe("gpt-5.6-sol")
    expect(resolved.spec.variant).toBe("medium")
    expect(resolved.availableCategories).toContain("writing")
  })

  test("#given an openai-only live registry #when quick resolves #then luna-fast is used with no synthesized variant", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)

    // when
    const result = resolveCategory("quick", {}, registry_)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("openai")
    expect(resolved.spec.modelId).toBe("gpt-5.6-luna-fast")
    expect(resolved.spec.variant).toBeUndefined()
  })

  test("#given an openai-only live registry #when visual-engineering resolves #then the maintained high effort replaces the generic medium rung", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)

    // when
    const result = resolveCategory("visual-engineering", {}, registry_)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("openai")
    expect(resolved.spec.modelId).toBe("gpt-5.6-sol")
    expect(resolved.spec.variant).toBe("high")
  })

  test("#given an explicit user categories entry #when writing resolves #then the user model wins and no overlay applies", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)
    const config = { categories: { writing: { model: "openai/gpt-5.6-terra", variant: "low" } } }

    // when
    const result = resolveCategory("writing", config, registry_)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("openai")
    expect(resolved.spec.modelId).toBe("gpt-5.6-terra")
    expect(resolved.spec.variant).toBe("low")
  })

  test("#given a disabled artistry category #when resolved against an openai-only registry #then it stays disabled", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)

    // when
    const result = resolveCategory("artistry", { categories: { artistry: { disable: true } } }, registry_)

    // then
    expect(result.kind).toBe("disabled")
  })

  test("#given the architect required-model gate #when resolved against an openai-only registry #then no recommendation is synthesized", () => {
    // given
    const registry_ = registry(OPENAI_ONLY_INVENTORY)

    // when
    const result = resolveCategory("architect", {}, registry_)

    // then
    expect(result.kind).toBe("model_unavailable")
  })

  test("#given a mixed multi-provider inventory #when categories resolve #then static chain behavior is preserved", () => {
    // given
    const registry_ = registry([model("anthropic", "claude-opus-5"), ...OPENAI_ONLY_INVENTORY])

    // when
    const visual = resolveCategory("visual-engineering", {}, registry_)
    const artistry = resolveCategory("artistry", {}, registry_)

    // then
    const visualResolved = expectResolved(visual)
    expect(visualResolved.spec.provider).toBe("anthropic")
    expect(visualResolved.spec.modelId).toBe("claude-opus-5")
    expect(visualResolved.spec.variant).toBe("max")
    const artistryResolved = expectResolved(artistry)
    expect(artistryResolved.spec.provider).toBe("anthropic")
    expect(artistryResolved.spec.modelId).toBe("claude-opus-5")
    expect(artistryResolved.spec.variant).toBe("xhigh")
  })

  test("#given only an explicitly mapped provider alias #when visual-engineering resolves #then the alias entry satisfies the recommendation", () => {
    // given
    const registry_ = aliasRegistry([
      { provider: "quotio-openai", id: "sol", upstream: "gpt-5.6-sol" },
      { provider: "quotio-openai", id: "luna", upstream: "gpt-5.6-luna-fast" },
    ])

    // when
    const result = resolveCategory("visual-engineering", {}, registry_)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("quotio-openai")
    expect(resolved.spec.modelId).toBe("sol")
    expect(resolved.spec.variant).toBe("high")
  })

  test("#given an alias inventory but a registry without getUpstreamModelId #when visual-engineering resolves #then the overlay fails closed", () => {
    // given
    const registry_ = registry([model("quotio-openai", "sol"), model("quotio-openai", "luna")])

    // when
    const result = resolveCategory("visual-engineering", {}, registry_)

    // then
    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an unrelated openai-compatible endpoint with custom model ids #when artistry resolves #then identity is never inferred from the wire protocol", () => {
    // given
    const registry_ = registry([model("my-relay", "fast-v9"), model("my-relay", "big-v9")])

    // when
    const result = resolveCategory("artistry", {}, registry_)

    // then
    expect(result.kind).toBe("model_unavailable")
  })

  test("#given a malformed or empty registry surface #when a recommended category resolves #then the overlay fails closed", () => {
    // given
    const malformed: FakeRegistry = { getAvailable: () => "not-an-array", find: () => undefined }
    const empty = registry([])

    // when
    const malformedResult = resolveCategory("artistry", {}, malformed)
    const emptyResult = resolveCategory("artistry", {}, empty)

    // then
    expect(malformedResult.kind).toBe("model_unavailable")
    expect(emptyResult.kind).toBe("model_unavailable")
  })

  test("#given an otherwise openai-only inventory carrying ONE malformed entry #when a recommended category resolves #then the whole inventory is rejected rather than the entry skipped", () => {
    // given a partial or poisoned registry: valid OpenAI models plus one unusable entry
    const poisoned: FakeRegistry = {
      getAvailable: () => [...OPENAI_ONLY_INVENTORY, null],
      find: (provider, modelId) =>
        OPENAI_ONLY_INVENTORY.find((candidate) => candidate.provider === provider && candidate.id === modelId),
    }

    // when
    const clean = resolveCategory("artistry", {}, registry(OPENAI_ONLY_INVENTORY))
    const result = resolveCategory("artistry", {}, poisoned)

    // then the clean inventory activates the overlay, the poisoned one must not: dropping the bad
    // entry would leave a non-empty all-OpenAI list and authorize from a registry we cannot vouch for
    expect(expectResolved(clean).spec.variant).toBe("xhigh")
    expect(result.kind).toBe("model_unavailable")
  })

  test("#given a registry whose getUpstreamModelId is a prototype method reading `this` #when an aliased openai model resolves #then the receiver is preserved", () => {
    // given a class-shaped registry, which is what the concrete senpi registry actually is
    class ClassRegistry {
      constructor(
        private readonly models: readonly FakeModel[],
        private readonly upstream: ReadonlyMap<string, string>,
      ) {}
      getAvailable(): readonly FakeModel[] {
        return this.models
      }
      find(provider: string, modelId: string): FakeModel | undefined {
        return this.models.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      }
      getUpstreamModelId(candidate: FakeModel): string | undefined {
        return this.upstream.get(`${candidate.provider}/${candidate.id}`)
      }
    }
    const registry_ = new ClassRegistry(
      [model("my-openai-alias", "sol")],
      new Map([["my-openai-alias/sol", "gpt-5.6-sol"]]),
    ) as FakeRegistry

    // when
    const result = resolveCategory("artistry", {}, registry_)

    // then a bare extracted call would run with `this === undefined`, throw into the catch, and
    // silently fail the alias closed
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("my-openai-alias")
    expect(resolved.spec.variant).toBe("xhigh")
  })

  test("#given a recommended category #when it resolves #then the registry is sampled exactly once so identity and availability share one snapshot", () => {
    // given
    let calls = 0
    const counting: FakeRegistry = {
      getAvailable: () => {
        calls += 1
        return OPENAI_ONLY_INVENTORY
      },
      find: (provider, modelId) =>
        OPENAI_ONLY_INVENTORY.find((candidate) => candidate.provider === provider && candidate.id === modelId),
    }

    // when
    resolveCategory("artistry", {}, counting)

    // then a second sample could return a different inventory and authorize a model the caller
    // never validated against
    expect(calls).toBe(1)
  })
})
