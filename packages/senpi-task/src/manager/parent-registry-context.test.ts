import { describe, expect, test } from "bun:test"

import { ModelRegistry, ModelRuntime } from "@code-yeongyu/senpi"

import { createParentRegistrySessionContext, findModelReference, resolveResumeContext } from "./parent-registry-context"
import type { ManagedStartSpec } from "./types"
import type { ResolvedModelRecord } from "../state"

function baseSpec(overrides: Partial<ManagedStartSpec> = {}): ManagedStartSpec {
  return {
    taskId: "st_child",
    cwd: "/tmp/project",
    stateDir: "/tmp/project/.omo/task",
    prompt: "do the child work",
    depth: 1,
    parentSessionId: "parent-session",
    rootSessionId: "parent-session",
    ...overrides,
  }
}

function registryWithMockProvider(): ModelRegistry {
  const registry = new ModelRegistry(ModelRuntime.createSync())
  registry.registerProvider("omo-mock", {
    name: "omo mock provider",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [
      {
        id: "mock-1",
        name: "Mock 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_000,
        maxTokens: 4096,
      },
    ],
  })
  return registry
}

describe("findModelReference", () => {
  test("#given a canonical provider/modelId reference #when resolved #then find is called with the split parts", () => {
    // given
    const calls: Array<{ provider: string; modelId: string }> = []
    const registry = {
      find: (provider: string, modelId: string) => {
        calls.push({ provider, modelId })
        return { provider, id: modelId }
      },
    }

    // when
    const model = findModelReference(registry, "omo-mock/mock-1")

    // then
    expect(calls).toEqual([{ provider: "omo-mock", modelId: "mock-1" }])
    expect(model).toEqual({ provider: "omo-mock", id: "mock-1" })
  })

  test("#given a modelId that itself contains slashes #when resolved #then only the FIRST slash splits provider from modelId", () => {
    // given
    const calls: Array<{ provider: string; modelId: string }> = []
    const registry = {
      find: (provider: string, modelId: string) => {
        calls.push({ provider, modelId })
        return undefined
      },
    }

    // when
    findModelReference(registry, "openrouter/anthropic/claude-3.5")

    // then
    expect(calls).toEqual([{ provider: "openrouter", modelId: "anthropic/claude-3.5" }])
  })

  test("#given a reference without a usable slash boundary #when resolved #then it returns undefined without calling find", () => {
    // given
    let called = false
    const registry = {
      find: () => {
        called = true
        return { provider: "x", id: "y" }
      },
    }

    // when / then
    expect(findModelReference(registry, "no-slash")).toBeUndefined()
    expect(findModelReference(registry, "/leading")).toBeUndefined()
    expect(findModelReference(registry, "trailing/")).toBeUndefined()
    expect(called).toBe(false)
  })
})

describe("createParentRegistrySessionContext", () => {
  test("#given no parent registry yet #when the context is built #then it stays empty so senpi keeps its default resolution", () => {
    // given
    const provide = createParentRegistrySessionContext(() => undefined)

    // when
    const context = provide(baseSpec({ model: "omo-mock/mock-1" }))

    // then
    expect(context).toEqual({})
  })

  test("#given a parent registry with a dynamically-registered provider #when a child spec names that model #then the registry, its auth storage, and the resolved Model are threaded", () => {
    // given
    const registry = registryWithMockProvider()
    const modelRuntime = registry.modelRuntime
    const provide = createParentRegistrySessionContext(() => registry)

    // when
    const context = provide(baseSpec({ model: "omo-mock/mock-1" }))

    // then
    expect(context.modelRegistry).toBe(registry)
    expect(context.modelRuntime).toBe(modelRuntime)
    expect(context.authStorage).toBe(registry.authStorage)
    expect(context.model?.provider).toBe("omo-mock")
    expect(context.model?.id).toBe("mock-1")
  })

  test("#given a parent registry but no model on the spec #when the context is built #then registry and auth are threaded with no model override", () => {
    // given
    const registry = registryWithMockProvider()
    const provide = createParentRegistrySessionContext(() => registry)

    // when
    const context = provide(baseSpec())

    // then
    expect(context.modelRegistry).toBe(registry)
    expect(context.authStorage).toBe(registry.authStorage)
    expect(context.model).toBeUndefined()
  })

  test("#given a spec carrying a valid resolved variant #when the context is built #then it maps to the senpi thinking level", () => {
    // given
    const registry = registryWithMockProvider()
    const provide = createParentRegistrySessionContext(() => registry)

    // when
    const context = provide(baseSpec({ model: "omo-mock/mock-1", variant: "xhigh" }))

    // then
    expect(context.thinkingLevel).toBe("xhigh")
  })

  test("#given a spec carrying an unknown variant #when the context is built #then no thinking level is threaded", () => {
    // given
    const registry = registryWithMockProvider()
    const provide = createParentRegistrySessionContext(() => registry)

    // when
    const context = provide(baseSpec({ model: "omo-mock/mock-1", variant: "ultra" }))

    // then
    expect(context.thinkingLevel).toBeUndefined()
  })

  test("#given a model reference absent from the parent registry #when the context is built #then registry is still threaded but no Model is set", () => {
    // given
    const registry = registryWithMockProvider()
    const provide = createParentRegistrySessionContext(() => registry)

    // when
    const context = provide(baseSpec({ model: "omo-mock/does-not-exist" }))

    // then
    expect(context.modelRegistry).toBe(registry)
    expect(context.model).toBeUndefined()
  })
})

describe("resolveResumeContext", () => {
  test("#given a spec whose resolved_model provider+model_id exist in the live registry #when resolved #then it returns ok with the exact model and registry context", () => {
    // given
    const registry = registryWithMockProvider()
    const resolvedModel: ResolvedModelRecord = {
      provider: "omo-mock",
      model_id: "mock-1",
      display: "Mock 1",
      source: "explicit",
    }
    const spec = baseSpec({ resolvedModel })

    // when
    const result = resolveResumeContext(() => registry, spec)

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.modelRegistry).toBe(registry)
      expect(result.context.authStorage).toBe(registry.authStorage)
      expect(result.context.model?.provider).toBe("omo-mock")
      expect(result.context.model?.id).toBe("mock-1")
    }
  })

  test("#given a spec whose resolved_model provider was removed from the live registry #when resolved #then it returns model_unavailable and never drifts to a substitute", () => {
    // given
    const registry = registryWithMockProvider()
    const resolvedModel: ResolvedModelRecord = {
      provider: "omo-mock",
      model_id: "does-not-exist",
      display: "Mock 1",
      source: "explicit",
    }
    const spec = baseSpec({ resolvedModel })

    // when
    const result = resolveResumeContext(() => registry, spec)

    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("model_unavailable")
      expect(result.reason).toContain("omo-mock")
      expect(result.reason).toContain("does-not-exist")
    }
  })

  test("#given a spec whose display string differs from the canonical provider/model_id #when resolved #then it keys on provider+model_id, not display, and resolves correctly", () => {
    // given
    const registry = registryWithMockProvider()
    // display says something completely different from the registry id
    const resolvedModel: ResolvedModelRecord = {
      provider: "omo-mock",
      model_id: "mock-1",
      display: "Some Human Label That Does Not Match",
      source: "explicit",
    }
    const spec = baseSpec({ resolvedModel })

    // when
    const result = resolveResumeContext(() => registry, spec)

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.model?.provider).toBe("omo-mock")
      expect(result.context.model?.id).toBe("mock-1")
    }
  })

  test("#given a spec whose provider+model_id match one model but display matches a DIFFERENT model in the registry #when resolved #then it resolves the provider+model_id match, never the display match", () => {
    // given
    const registry = new ModelRegistry(ModelRuntime.createSync())
    registry.registerProvider("omo-mock", {
      name: "omo mock provider",
      baseUrl: "file://mock-provider",
      apiKey: "mock",
      api: "openai-completions",
      models: [
        {
          id: "mock-1",
          name: "Mock 1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 16_000,
          maxTokens: 4096,
        },
        {
          id: "mock-2",
          name: "Mock 2",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 16_000,
          maxTokens: 4096,
        },
      ],
    })
    // canonical provider/model_id point to mock-1, but display deceptively says mock-2's name
    const resolvedModel: ResolvedModelRecord = {
      provider: "omo-mock",
      model_id: "mock-1",
      display: "Mock 2",
      source: "explicit",
    }
    const spec = baseSpec({ resolvedModel })

    // when
    const result = resolveResumeContext(() => registry, spec)

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Must resolve to mock-1 (the canonical model_id), NOT mock-2 (the display string)
      expect(result.context.model?.id).toBe("mock-1")
    }
  })

  test("#given no live parent registry available #when resolved #then it returns model_unavailable, never silently drifting to a default", () => {
    // given
    const resolvedModel: ResolvedModelRecord = {
      provider: "omo-mock",
      model_id: "mock-1",
      display: "Mock 1",
      source: "explicit",
    }
    const spec = baseSpec({ resolvedModel })

    // when
    const result = resolveResumeContext(() => undefined, spec)

    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("model_unavailable")
    }
  })

  test("#given a spec with no resolved_model at all #when resolved #then it returns model_unavailable", () => {
    // given
    const registry = registryWithMockProvider()
    const spec = baseSpec()

    // when
    const result = resolveResumeContext(() => registry, spec)

    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("model_unavailable")
    }
  })
})
