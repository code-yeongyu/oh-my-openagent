import { describe, expect, test } from "bun:test"

import { AuthStorage, ModelRegistry } from "@code-yeongyu/senpi"

import { createParentRegistrySessionContext, findModelReference } from "./parent-registry-context"
import type { ManagedStartSpec } from "./types"

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
  const registry = ModelRegistry.inMemory(AuthStorage.inMemory())
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
    const provide = createParentRegistrySessionContext(() => registry)

    // when
    const context = provide(baseSpec({ model: "omo-mock/mock-1" }))

    // then
    expect(context.modelRegistry).toBe(registry)
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
